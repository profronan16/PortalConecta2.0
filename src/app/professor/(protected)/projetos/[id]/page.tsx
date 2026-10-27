'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronRight, Users, FolderOpen, Calendar, Mail,
  Download, Search, Filter, AlertCircle, CheckCircle,
  Clock, XCircle, Eye, ArrowLeft, FileText, Plus, Trash2, Briefcase, Loader2, ExternalLink,
  ShieldCheck, UserPlus, Pencil,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getProjetoDetalhes, listInscricoes, updateInscricaoStatus, exportInscricoesCSV, toggleInscricoes, abrirInscricoes,
  listVagas, createVaga, updateVaga, deleteVaga, type VagaFormData,
  listarGestoresDaPagina, listarCandidatosAGestor, definirGestorDaPagina,
  getEquipeDoProjeto, salvarEquipeEFinanciamento,
  type GestorDaPagina, type CandidatoAGestor,
} from '@/actions/professor';
import {
  EquipeEFinanciamentoDoProjeto,
  type EquipeEFinanciamentoValores,
} from '@/components/projetos/EquipeEFinanciamentoDoProjeto';
import type { EquipeDoProjeto } from '@/lib/projetos-equipe';
import { getStatusLabel, getStatusColor, formatDateShort } from '@/lib/utils';
import { rotuloRespostaAluno } from '@/lib/inscricao-aluno';
import { vagaExcedeCota } from '@/lib/vagas';
import { parsePerguntasExtra, resolverRespostasExtra } from '@/lib/formulario-extra';
import { AbrirInscricoesModal } from '@/components/ui/AbrirInscricoesModal';
import { Prisma } from '@prisma/client';
import { useToast } from '@/components/ui/toast';

type Projeto = NonNullable<Awaited<ReturnType<typeof getProjetoDetalhes>>>;
type Inscricao = Prisma.InscricaoGetPayload<{}>;
type Vaga = Prisma.VagaGetPayload<{}> & { selecionados: number };

export default function ProfessorProjetoDetalhePage({ params }: { params: { id: string } }) {
  const { user, userRole } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const somenteGestor = userRole === 'ESTUDANTE';
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [inscricoes, setInscricoes] = useState<Inscricao[]>([]);
  const [vagas, setVagas] = useState<Vaga[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('todos');
  const [search, setSearch] = useState('');
  const [showVagaForm, setShowVagaForm] = useState(false);
  const [editingVaga, setEditingVaga] = useState<Vaga | null>(null);
  const [showAbrirModal, setShowAbrirModal] = useState(false);
  const [togglingInscricoes, setTogglingInscricoes] = useState(false);
  const [gestores, setGestores] = useState<GestorDaPagina[]>([]);
  const [candidatos, setCandidatos] = useState<CandidatoAGestor[]>([]);
  const [novoGestor, setNovoGestor] = useState('');
  const [salvandoGestor, setSalvandoGestor] = useState(false);
  // Mudança de status fica "em rascunho" até o professor clicar em Confirmar.
  // É o que evita o aluno receber uma notificação a cada troca no select.
  const [pendingStatus, setPendingStatus] = useState<Record<string, string>>({});
  const [confirmandoStatus, setConfirmandoStatus] = useState<string | null>(null);

  // Bloco "Equipe e financiamento": mesmo componente do painel "Editar Projeto"
  // e da "Página do projeto". A equipe de estudantes sai das inscrições.
  const [equipe, setEquipe] = useState<EquipeDoProjeto | null>(null);
  const [dadosEquipe, setDadosEquipe] = useState<EquipeEFinanciamentoValores>({});
  const [salvandoEquipe, setSalvandoEquipe] = useState(false);

  const recarregarEquipe = async () => {
    if (!user?.email) return;
    setEquipe(await getEquipeDoProjeto(params.id, user.email));
  };

  const salvarEquipe = async () => {
    if (!user?.email) return;
    setSalvandoEquipe(true);
    const r = await salvarEquipeEFinanciamento(
      params.id,
      {
        financiamento: dadosEquipe.financiamento ?? [],
        viceCoordenadorNome: dadosEquipe.viceCoordenadorNome ?? '',
        viceCoordenadorEmail: dadosEquipe.viceCoordenadorEmail ?? '',
      },
      user.email,
    );
    toast(r.ok ? 'Vice-coordenação e financiamento atualizados.' : r.error, r.ok ? 'success' : 'error');
    setSalvandoEquipe(false);
  };

  const recarregarGestores = async () => {
    if (!user?.email) return;
    const [g, c] = await Promise.all([
      listarGestoresDaPagina(params.id, user.email),
      listarCandidatosAGestor(params.id, user.email),
    ]);
    if (g.ok) setGestores(g.data);
    if (c.ok) setCandidatos(c.data);
  };

  const adicionarGestor = async () => {
    if (!user?.email || !novoGestor) return;
    setSalvandoGestor(true);
    const r = await definirGestorDaPagina(params.id, novoGestor, true, user.email);
    if (r.ok) {
      toast('Aluno nomeado gestor da página', 'success');
      setNovoGestor('');
      await recarregarGestores();
    } else {
      toast(r.error, 'error');
    }
    setSalvandoGestor(false);
  };

  const removerGestor = async (userId: string, nome: string) => {
    if (!user?.email) return;
    if (!confirm(`Remover ${nome} como gestor da página deste projeto?`)) return;
    setSalvandoGestor(true);
    const r = await definirGestorDaPagina(params.id, userId, false, user.email);
    if (r.ok) {
      toast('Gestor removido', 'success');
      await recarregarGestores();
    } else {
      toast(r.error, 'error');
    }
    setSalvandoGestor(false);
  };

  const recarregarVagas = async () => {
    if (!user?.email) return;
    const result = await listVagas(params.id, user.email);
    if (result.ok && 'data' in result && result.data) setVagas(result.data);
  };

  useEffect(() => {
    if (somenteGestor) router.replace(`/professor/projetos/${params.id}/pagina`);
  }, [somenteGestor, params.id, router]);

  useEffect(() => {
    if (!user?.email || somenteGestor) { if (somenteGestor) setLoading(false); return; }
    getProjetoDetalhes(params.id, user.email)
      .then((p) => {
        if (!p) { router.replace('/professor'); return; }
        setProjeto(p);
        setDadosEquipe({
          financiamento: p.financiamento ?? [],
          viceCoordenadorNome: p.viceCoordenadorNome ?? '',
          viceCoordenadorEmail: p.viceCoordenadorEmail ?? '',
        });
        void recarregarEquipe().catch(console.error);
        void recarregarGestores().catch(console.error);
        return Promise.all([
          listInscricoes(params.id, user.email!),
          listVagas(params.id, user.email!),
        ]);
      })
      .then((result) => {
        if (!result) return;
        const [inscricoesResult, vagasResult] = result;
        if (inscricoesResult && 'data' in inscricoesResult && Array.isArray(inscricoesResult.data)) {
          setInscricoes(inscricoesResult.data);
        }
        if (vagasResult && 'data' in vagasResult && vagasResult.data) {
          setVagas(vagasResult.data);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user, params.id, router, somenteGestor]);

  const vagaPorId = new Map(vagas.map((v) => [v.id, v]));

  const handleSaveVaga = async (data: VagaFormData) => {
    if (!projeto || !user?.email) return;
    const result = editingVaga
      ? await updateVaga(editingVaga.id, data, user.email)
      : await createVaga(projeto.id, data, user.email);

    if (result.ok) {
      toast(editingVaga ? 'Vaga atualizada' : 'Vaga criada', 'success');
      setShowVagaForm(false);
      setEditingVaga(null);
      recarregarVagas();
    } else {
      toast(result.error || 'Não conseguimos salvar a vaga. Confira os campos e tente novamente.', 'error');
    }
  };

  const handleDeleteVaga = async (vaga: Vaga) => {
    if (!user?.email) return;
    if (!confirm(`Excluir a vaga "${vaga.titulo}"?\n\nEsta ação não pode ser desfeita.`)) return;
    const result = await deleteVaga(vaga.id, user.email);
    if (result.ok) {
      toast('Vaga excluída', 'success');
      recarregarVagas();
    } else {
      toast(result.error || 'Não conseguimos excluir esta vaga. Tente novamente.', 'error');
    }
  };

  const handleToggleVagaStatus = async (vaga: Vaga) => {
    if (!user?.email) return;
    const novoStatus = vaga.status === 'ABERTA' ? 'ENCERRADA' : 'ABERTA';
    const result = await updateVaga(vaga.id, { status: novoStatus }, user.email);
    if (result.ok) {
      recarregarVagas();
      toast(
        novoStatus === 'ABERTA' ? 'Vaga reaberta para inscrições' : 'Vaga encerrada',
        'success'
      );
    } else {
      toast(result.error || 'Não conseguimos alterar a situação desta vaga. Tente novamente.', 'error');
    }
  };

  const confirmarStatus = async (inscricaoId: string) => {
    if (!user?.email) return;
    const newStatus = pendingStatus[inscricaoId];
    if (!newStatus) return;

    setConfirmandoStatus(inscricaoId);
    const result = await updateInscricaoStatus(inscricaoId, newStatus, undefined, user.email);
    if (result.ok) {
      setInscricoes((prev) =>
        prev.map((i) => (i.id === inscricaoId ? { ...i, status: newStatus } : i))
      );
      setPendingStatus((prev) => {
        const next = { ...prev };
        delete next[inscricaoId];
        return next;
      });
      toast(
        `Alteração confirmada: "${getStatusLabel(newStatus)}". O aluno será notificado.`,
        'success',
      );
      // Um aluno recém-selecionado passa a aparecer na lista de candidatos a
      // gestor da página sem precisar recarregar o painel.
      void recarregarGestores().catch(console.error);
      void recarregarEquipe().catch(console.error);
    } else {
      toast(result.error || 'Não conseguimos alterar o status desta inscrição. Tente novamente.', 'error');
    }
    setConfirmandoStatus(null);
  };

  const handleExport = async () => {
    if (!projeto || !user?.email) return;
    const result = await exportInscricoesCSV(projeto.id, user.email);
    if (!result.ok) { toast(result.error, 'error'); return; }
    const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inscricoes-${projeto.slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleToggleInscricoes = async () => {
    if (!projeto || !user?.email) return;
    // Abrir exige configurar o prazo primeiro (pop-up); fechar não precisa.
    if (!projeto.inscricoes_abertas) {
      setShowAbrirModal(true);
      return;
    }
    // Atualização otimista — muda o botão na hora, sem esperar o servidor,
    // e o próprio botão fica desabilitado com spinner até confirmar (evita
    // parecer travado e o usuário clicar várias vezes). Reverte se falhar.
    setTogglingInscricoes(true);
    setProjeto({ ...projeto, inscricoes_abertas: false, status: 'ATIVO' });
    try {
      const result = await toggleInscricoes(projeto.id, user.email);
      if (!result.ok) {
        setProjeto({ ...projeto, inscricoes_abertas: true, status: 'INSCRICOES_ABERTAS' });
        toast(result.error, 'error');
      }
    } finally {
      setTogglingInscricoes(false);
    }
  };

  const handleConfirmAbrirInscricoes = async (data: { inscricaoInicio?: string; inscricaoFim: string }) => {
    if (!projeto || !user?.email) return;
    const result = await abrirInscricoes(projeto.id, user.email, data);
    if (result.ok && 'data' in result && result.data) {
      setProjeto({ ...projeto, inscricoes_abertas: result.data.inscricoes_abertas, status: 'INSCRICOES_ABERTAS' });
      setShowAbrirModal(false);
    }
  };

  const filtered = inscricoes.filter((i) => {
    const matchesSearch =
      i.nome_completo.toLowerCase().includes(search.toLowerCase()) ||
      i.email.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'todos' || i.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusCounts = inscricoes.reduce(
    (acc, i) => { acc[i.status] = (acc[i.status] || 0) + 1; return acc; },
    {} as Record<string, number>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400 text-sm">Carregando detalhes...</div>
      </div>
    );
  }

  if (!projeto) return null;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/professor" className="hover:text-azul-eletrico transition-colors">Dashboard</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link href="/professor/projetos" className="hover:text-azul-eletrico transition-colors">Projetos</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-gray-900 font-medium">{projeto.nome}</span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div
          className="h-24 relative flex items-end p-6"
          style={{ background: `linear-gradient(135deg, ${projeto.corPrimaria} 0%, ${projeto.corPrimaria}cc 100%)` }}
        >
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-white font-black text-2xl border border-white/30">
            {projeto.nome.charAt(0)}
          </div>
          <div className="ml-4 flex-1">
            <h1 className="text-2xl font-black text-white">{projeto.nome}</h1>
            <p className="text-white/80 text-sm">{projeto.area}</p>
          </div>
          <span className="text-white/80 text-xs bg-black/20 rounded-full px-3 py-1 font-medium">
            {getStatusLabel(projeto.status)}
          </span>
        </div>

        {/* Ações rápidas */}
        <div className="px-6 py-3 border-b border-gray-50 flex flex-wrap gap-2">
          {/* Página pública: o professor confere o que o estudante vê sem sair
              do painel (abre em outra aba). */}
          <Link
            href={`/projetos/${projeto.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir a página pública do projeto (como o estudante vê)"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Ver no portal
          </Link>
          <Link
            href={`/professor/projetos/${params.id}/posts`}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Gerenciar Posts
          </Link>
          <Link
            href={`/professor/projetos/${params.id}/pagina`}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Editar página
          </Link>
          <button
            onClick={handleToggleInscricoes}
            disabled={togglingInscricoes}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-wait ${
              projeto.inscricoes_abertas
                ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
            }`}
          >
            {togglingInscricoes ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {projeto.inscricoes_abertas ? 'Fechando...' : 'Abrindo...'}
              </>
            ) : projeto.inscricoes_abertas ? (
              <>
                <CheckCircle className="w-3.5 h-3.5" />
                Inscrições Abertas
              </>
            ) : (
              <>
                <XCircle className="w-3.5 h-3.5" />
                Inscrições Fechadas
              </>
            )}
          </button>
        </div>

        <div className="p-6">
          <p className="text-gray-600 text-sm leading-relaxed mb-4">{projeto.descricao}</p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-400 text-xs mb-1">Coordenador</p>
              <p className="font-medium text-gray-900">{projeto.coordenador}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Email</p>
              <p className="font-medium text-gray-900">{projeto.coordenadorEmail}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Vagas</p>
              <p className="font-medium text-gray-900">
                {projeto.vagasBolsista} bolsista{projeto.vagasVoluntario > 0 ? ` / ${projeto.vagasVoluntario} voluntário` : ''}
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Inscrições</p>
              <p className="font-medium text-gray-900">{projeto.status === 'INSCRICOES_ABERTAS' ? 'Abertas' : 'Fechadas'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Equipe e financiamento — mesmo bloco do painel "Editar Projeto" e da
          "Página do projeto" */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="p-5 space-y-4">
          <EquipeEFinanciamentoDoProjeto
            valores={dadosEquipe}
            onChange={(alteracao) => setDadosEquipe((atual) => ({ ...atual, ...alteracao }))}
            equipe={equipe}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={salvarEquipe}
              disabled={salvandoEquipe}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-azul-eletrico text-white text-sm font-semibold hover:bg-azul-eletrico/90 disabled:opacity-60 transition-colors"
            >
              {salvandoEquipe && <Loader2 className="w-4 h-4 animate-spin" />}
              {salvandoEquipe ? 'Salvando...' : 'Salvar vice e financiamento'}
            </button>
          </div>
        </div>
      </div>

      {/* Gestores da página */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h2 className="font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-azul-eletrico" />
            Gestores da página ({gestores.length})
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Alunos bolsistas ou voluntários selecionados neste projeto que podem editar os posts
            e a apresentação pública da página. Eles <strong>não</strong> podem alterar dados
            sensíveis, abrir vagas, ver inscrições ou excluir o projeto.
          </p>
        </div>

        <div className="p-5 space-y-4">
          {gestores.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nenhum aluno é gestor da página ainda.
            </p>
          ) : (
            <div className="divide-y divide-gray-50 rounded-xl border border-gray-100">
              {gestores.map((g) => (
                <div key={g.userId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{g.nome}</p>
                    <p className="text-xs text-gray-500 truncate">{g.email}</p>
                  </div>
                  <button
                    onClick={() => removerGestor(g.userId, g.nome)}
                    disabled={salvandoGestor}
                    className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-60 transition-colors"
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
          )}

          {candidatos.filter((c) => !c.jaEhGestor).length > 0 ? (
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <select
                value={novoGestor}
                onChange={(e) => setNovoGestor(e.target.value)}
                className="input-field flex-1"
              >
                <option value="">Selecione um aluno selecionado...</option>
                {candidatos.filter((c) => !c.jaEhGestor).map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.nome} — {c.tipoInteresse === 'AMBOS' ? 'Bolsista/Voluntário' : c.tipoInteresse === 'BOLSISTA' ? 'Bolsista' : 'Voluntário'}
                  </option>
                ))}
              </select>
              <button
                onClick={adicionarGestor}
                disabled={!novoGestor || salvandoGestor}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-azul-eletrico text-white text-sm font-semibold hover:bg-azul-eletrico/90 disabled:opacity-50 transition-colors"
              >
                {salvandoGestor ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Nomear gestor
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              {candidatos.length === 0
                ? 'Nenhum aluno selecionado com conta no portal ainda. Marque um candidato como “selecionado” para poder nomeá-lo.'
                : 'Todos os alunos selecionados já são gestores da página.'}
            </p>
          )}
        </div>
      </div>

      {/* Vagas */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold text-gray-900">Vagas ({vagas.length})</h2>
          <button
            onClick={() => { setEditingVaga(null); setShowVagaForm(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-azul-eletrico text-white text-sm font-medium hover:bg-azul-eletrico/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Vaga
          </button>
        </div>

        {vagas.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <Briefcase className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhuma vaga cadastrada — o formulário de inscrição usa o modo antigo (bolsista/voluntário genérico).</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {vagas.map((vaga) => (
              <div key={vaga.id} className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900 text-sm">{vaga.titulo}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      vaga.status === 'ABERTA' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {vaga.status === 'ABERTA' ? 'Aberta' : vaga.status === 'EM_SELECAO' ? 'Em seleção' : vaga.status === 'ENCERRADA' ? 'Encerrada' : 'Cancelada'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {vaga.tipo === 'AMBOS' ? 'Bolsista ou Voluntário' : vaga.tipo === 'BOLSISTA' ? 'Bolsista' : 'Voluntário'}
                    {' · '}
                    <strong className={vagaExcedeCota(vaga.selecionados, vaga.quantidade) ? 'text-red-600' : 'text-gray-700'}>
                      {vaga.selecionados}/{vaga.quantidade}
                    </strong> preenchida(s)
                    {vaga.valorBolsa ? ` · R$ ${vaga.valorBolsa.toFixed(2)}/mês` : ''}
                  </p>
                  {/* Estado antigo, de antes de o portal limitar a seleção por
                      vaga: mais gente selecionada do que posições. Sem este
                      aviso, a coordenação só descobria o problema ao tentar
                      selecionar mais alguém e receber o bloqueio. */}
                  {vagaExcedeCota(vaga.selecionados, vaga.quantidade) && (
                    <p className="text-xs text-red-600 mt-1">
                      {vaga.selecionados} selecionados para {vaga.quantidade} posição(ões): coloque alguém em
                      lista de espera ou aumente a quantidade de posições.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleToggleVagaStatus(vaga)}
                    className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    {vaga.status === 'ABERTA' ? 'Encerrar' : 'Reabrir'}
                  </button>
                  <button
                    onClick={() => { setEditingVaga(vaga); setShowVagaForm(true); }}
                    className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDeleteVaga(vaga)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                    title="Excluir vaga"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showVagaForm && (
        <VagaFormModal
          vaga={editingVaga}
          onSave={handleSaveVaga}
          onClose={() => { setShowVagaForm(false); setEditingVaga(null); }}
        />
      )}

      {/* Inscritos */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold text-gray-900">Inscrições ({inscricoes.length})</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar CSV
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="px-5 py-3 border-b border-gray-50 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="search"
              placeholder="Buscar por nome ou email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {['todos', 'recebida', 'em_analise', 'selecionado', 'nao_selecionado'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  statusFilter === s
                    ? 'bg-azul-eletrico text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s === 'todos' ? 'Todos' : s.replace(/_/g, ' ')}
                {s !== 'todos' && statusCounts[s] ? ` (${statusCounts[s]})` : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Lista */}
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Nenhuma inscrição encontrada</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                  <th className="px-5 py-3 font-medium">Inscrito</th>
                  <th className="px-5 py-3 font-medium">Curso</th>
                  <th className="px-5 py-3 font-medium">Vaga</th>
                  <th className="px-5 py-3 font-medium">Tipo</th>
                  <th className="px-5 py-3 font-medium">Data</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((inscricao) => (
                  <tr key={inscricao.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900">{inscricao.nome_completo}</p>
                      <p className="text-xs text-gray-500">{inscricao.email}</p>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{inscricao.curso ?? '—'}</td>
                    <CelulaVagaInscricao
                      vagaId={inscricao.vaga_id}
                      vaga={inscricao.vaga_id ? vagaPorId.get(inscricao.vaga_id) : undefined}
                    />
                    <td className="px-5 py-3 text-gray-600">{inscricao.tipo_interesse}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {formatDateShort(inscricao.created_at)}
                    </td>
                    <td className="px-5 py-3">
                      <select
                        value={pendingStatus[inscricao.id] ?? inscricao.status}
                        onChange={(e) => setPendingStatus((prev) => ({ ...prev, [inscricao.id]: e.target.value }))}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-azul-eletrico/30"
                      >
                        <option value="recebida">Recebida</option>
                        <option value="em_analise">Em análise</option>
                        <option value="selecionado">Selecionado</option>
                        <option value="lista_espera">Lista espera</option>
                        <option value="nao_selecionado">Não selecionado</option>
                        <option value="desistente">Desistente</option>
                      </select>
                      {pendingStatus[inscricao.id] && pendingStatus[inscricao.id] !== inscricao.status && (
                        <div className="mt-1.5 flex items-center gap-1">
                          <button
                            onClick={() => confirmarStatus(inscricao.id)}
                            disabled={confirmandoStatus === inscricao.id}
                            className="px-2 py-1 rounded-md bg-azul-eletrico text-white text-[11px] font-semibold hover:bg-azul-eletrico/90 disabled:opacity-60 transition-colors"
                          >
                            {confirmandoStatus === inscricao.id ? 'Confirmando...' : 'Confirmar alteração'}
                          </button>
                          <button
                            onClick={() => setPendingStatus((prev) => {
                              const next = { ...prev };
                              delete next[inscricao.id];
                              return next;
                            })}
                            className="px-2 py-1 rounded-md border border-gray-200 text-[11px] text-gray-600 hover:bg-gray-50 transition-colors"
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                      {/* O que o ALUNO respondeu à convocação. Fica visível na
                          lista (e não só no detalhe) porque é a informação que
                          decide se a vaga está realmente preenchida. */}
                      {rotuloRespostaAluno(inscricao.resposta_aluno) && (
                        <p className={`text-[11px] font-semibold mt-1 ${
                          inscricao.resposta_aluno === 'aceito' ? 'text-green-700' : 'text-orange-700'
                        }`}>
                          {rotuloRespostaAluno(inscricao.resposta_aluno)}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => {
                          const perguntasExtra = parsePerguntasExtra(projeto?.formulario_extra);
                          const respostasExtra = resolverRespostasExtra(perguntasExtra, inscricao.campos_extra);
                          // Antes era um `alert()` nativo (trava a aba e não
                          // segue o visual do portal). Agora é um toast, com os
                          // mesmos dados e rótulos legíveis.
                          const linhas: string[] = [`Protocolo ${inscricao.protocolo} — ${inscricao.nome_completo}`];
                          if (inscricao.email) linhas.push(`E-mail: ${inscricao.email}`);
                          if (inscricao.telefone) linhas.push(`Telefone: ${inscricao.telefone}`);
                          if (inscricao.curso) linhas.push(`Curso: ${inscricao.curso}`);
                          if (inscricao.turma) linhas.push(`Turma: ${inscricao.turma}`);
                          if (inscricao.semestre) linhas.push(`Semestre: ${inscricao.semestre}`);
                          // Resposta do próprio aluno a uma convocação — é o
                          // que diz se ele topou a vaga ou abriu mão dela.
                          const resposta = rotuloRespostaAluno(inscricao.resposta_aluno);
                          if (resposta) linhas.push(`Resposta do aluno: ${resposta}`);
                          if (inscricao.justificativa) linhas.push(`Justificativa: ${inscricao.justificativa}`);
                          if (inscricao.experiencia_previa) linhas.push(`Experiência: ${inscricao.experiencia_previa}`);
                          respostasExtra.forEach((r) => linhas.push(`${r.pergunta}: ${r.resposta || '(sem resposta)'}`));
                          toast(linhas.join('\n'), 'info');
                        }}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                        title="Ver detalhes"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FAQ */}
      {projeto.faq.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <h2 className="font-bold text-gray-900">FAQ do Projeto</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {projeto.faq.map((faq) => (
              <div key={faq.id} className="px-5 py-4">
                <p className="font-semibold text-gray-900 text-sm mb-1">{faq.pergunta}</p>
                <p className="text-gray-600 text-sm">{faq.resposta}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAbrirModal && (
        <AbrirInscricoesModal
          onClose={() => setShowAbrirModal(false)}
          onConfirm={handleConfirmAbrirInscricoes}
        />
      )}
    </div>
  );
}

function VagaFormModal({
  vaga,
  onSave,
  onClose,
}: {
  vaga: Vaga | null;
  onSave: (data: VagaFormData) => void;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);

    const data: VagaFormData = {
      titulo: form.get('titulo') as string,
      tipo: form.get('tipo') as 'BOLSISTA' | 'VOLUNTARIO' | 'AMBOS',
      descricao: (form.get('descricao') as string) || undefined,
      requisitos: (form.get('requisitos') as string) || undefined,
      quantidade: Number(form.get('quantidade')),
      valorBolsa: form.get('valorBolsa') ? Number(form.get('valorBolsa')) : undefined,
      cargaHorariaSemanal: form.get('cargaHorariaSemanal') ? Number(form.get('cargaHorariaSemanal')) : undefined,
      vigenciaMeses: form.get('vigenciaMeses') ? Number(form.get('vigenciaMeses')) : undefined,
      fontePagadora: (form.get('fontePagadora') as string) || undefined,
      dataEncerramento: (form.get('dataEncerramento') as string) || undefined,
    };

    setSaving(true);
    await onSave(data);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold text-gray-900 text-lg mb-4">{vaga ? 'Editar Vaga' : 'Nova Vaga'}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Título" required>
            <input name="titulo" type="text" required className="input-field" defaultValue={vaga?.titulo} placeholder="Ex: Bolsista de Extensão" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Tipo" required>
              <select name="tipo" required className="input-field" defaultValue={vaga?.tipo ?? 'BOLSISTA'}>
                <option value="BOLSISTA">Bolsista</option>
                <option value="VOLUNTARIO">Voluntário</option>
                <option value="AMBOS">Ambos</option>
              </select>
            </Field>
            <Field label="Quantidade de posições" required>
              <input name="quantidade" type="number" min="1" required className="input-field" defaultValue={vaga?.quantidade ?? 1} />
            </Field>
          </div>

          <Field label="Descrição">
            <textarea name="descricao" className="input-field min-h-[70px] resize-none" defaultValue={vaga?.descricao ?? ''} />
          </Field>

          <Field label="Requisitos">
            <textarea name="requisitos" className="input-field min-h-[70px] resize-none" defaultValue={vaga?.requisitos ?? ''} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Valor da bolsa (R$/mês)">
              <input name="valorBolsa" type="number" step="0.01" min="0" className="input-field" defaultValue={vaga?.valorBolsa ?? ''} />
            </Field>
            <Field label="Carga horária semanal (h)">
              <input name="cargaHorariaSemanal" type="number" min="1" className="input-field" defaultValue={vaga?.cargaHorariaSemanal ?? ''} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Vigência (meses)">
              <input name="vigenciaMeses" type="number" min="1" className="input-field" defaultValue={vaga?.vigenciaMeses ?? ''} />
            </Field>
            <Field label="Prazo de inscrição">
              <input
                name="dataEncerramento"
                type="date"
                className="input-field"
                defaultValue={vaga?.dataEncerramento ? new Date(vaga.dataEncerramento).toISOString().slice(0, 10) : ''}
              />
            </Field>
          </div>

          <Field label="Fonte pagadora">
            <input name="fontePagadora" type="text" className="input-field" defaultValue={vaga?.fontePagadora ?? ''} placeholder="Ex: PIBEX, CNPq..." />
          </Field>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-all"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-azul-eletrico text-white font-semibold text-sm hover:bg-azul-eletrico/90 transition-all disabled:opacity-60"
            >
              {saving ? 'Salvando...' : vaga ? 'Salvar alterações' : 'Criar vaga'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

/**
 * Célula da vaga na tabela de inscrições: título + quantos já estão
 * selecionados sobre as posições. Existe porque "selecionado" é limitado PELA
 * VAGA (não pelo projeto) e a tabela não mostrava essa informação: a
 * coordenação levava um "vaga cheia" sem ver quem ocupava o quê.
 */
function CelulaVagaInscricao({ vagaId, vaga }: { vagaId: string | null; vaga?: Vaga }) {
  if (!vagaId) return <td className="px-5 py-3 text-gray-400">—</td>;
  if (!vaga) return <td className="px-5 py-3 text-gray-400">Vaga removida</td>;

  return (
    <td className="px-5 py-3 text-gray-600">
      {vaga.titulo}{' '}
      <span
        className={`font-semibold text-xs ${vagaExcedeCota(vaga.selecionados, vaga.quantidade) ? 'text-red-600' : 'text-gray-400'}`}
        title="Selecionados / posições desta vaga"
      >
        ({vaga.selecionados}/{vaga.quantidade})
      </span>
    </td>
  );
}
