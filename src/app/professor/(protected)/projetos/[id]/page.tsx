'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronRight, Users, FolderOpen, Calendar, Mail,
  Download, Search, Filter, AlertCircle, CheckCircle,
  Clock, XCircle, Eye, ArrowLeft, FileText, Plus, Trash2, Briefcase, Loader2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getProjetoDetalhes, listInscricoes, updateInscricaoStatus, exportInscricoesCSV, toggleInscricoes, abrirInscricoes,
  listVagas, createVaga, updateVaga, deleteVaga, type VagaFormData,
} from '@/actions/professor';
import { getStatusLabel, getStatusColor, formatDateShort } from '@/lib/utils';
import { parsePerguntasExtra, resolverRespostasExtra } from '@/lib/formulario-extra';
import { AbrirInscricoesModal } from '@/components/ui/AbrirInscricoesModal';
import { Prisma } from '@prisma/client';
import { useToast } from '@/components/ui/toast';

type Projeto = NonNullable<Awaited<ReturnType<typeof getProjetoDetalhes>>>;
type Inscricao = Prisma.InscricaoGetPayload<{}>;
type Vaga = Prisma.VagaGetPayload<{}> & { selecionados: number };

export default function ProfessorProjetoDetalhePage({ params }: { params: { id: string } }) {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
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

  const recarregarVagas = async () => {
    if (!user?.email) return;
    const result = await listVagas(params.id, user.email);
    if (result.ok && 'data' in result && result.data) setVagas(result.data);
  };

  useEffect(() => {
    if (!user?.email) return;
    getProjetoDetalhes(params.id, user.email)
      .then((p) => {
        if (!p) { router.replace('/professor'); return; }
        setProjeto(p);
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
  }, [user, params.id, router]);

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
      toast(result.error || 'Erro ao salvar vaga', 'error');
    }
  };

  const handleDeleteVaga = async (vaga: Vaga) => {
    if (!user?.email) return;
    if (!confirm(`Excluir a vaga "${vaga.titulo}"?`)) return;
    const result = await deleteVaga(vaga.id, user.email);
    if (result.ok) {
      toast('Vaga excluída', 'success');
      recarregarVagas();
    } else {
      toast(result.error || 'Erro ao excluir vaga', 'error');
    }
  };

  const handleToggleVagaStatus = async (vaga: Vaga) => {
    if (!user?.email) return;
    const novoStatus = vaga.status === 'ABERTA' ? 'ENCERRADA' : 'ABERTA';
    const result = await updateVaga(vaga.id, { status: novoStatus }, user.email);
    if (result.ok) {
      recarregarVagas();
    } else {
      toast(result.error || 'Erro ao alterar status da vaga', 'error');
    }
  };

  const handleStatusChange = async (inscricaoId: string, newStatus: string) => {
    if (!user?.email) return;
    const result = await updateInscricaoStatus(inscricaoId, newStatus, undefined, user.email);
    if (result.ok) {
      setInscricoes((prev) =>
        prev.map((i) => (i.id === inscricaoId ? { ...i, status: newStatus } : i))
      );
      toast(`Status alterado para "${newStatus.replace(/_/g, ' ')}"`, 'success');
    } else {
      toast(result.error || 'Erro ao alterar status', 'error');
    }
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
        <div className="px-6 py-3 border-b border-gray-50 flex gap-2">
          <Link
            href={`/professor/projetos/${params.id}/posts`}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Gerenciar Posts
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
                    <strong className="text-gray-700">{vaga.selecionados}/{vaga.quantidade}</strong> preenchida(s)
                    {vaga.valorBolsa ? ` · R$ ${vaga.valorBolsa.toFixed(2)}/mês` : ''}
                  </p>
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
                    <td className="px-5 py-3 text-gray-600">
                      {inscricao.vaga_id ? (vagaPorId.get(inscricao.vaga_id)?.titulo ?? 'Vaga removida') : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{inscricao.tipo_interesse}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {formatDateShort(inscricao.created_at)}
                    </td>
                    <td className="px-5 py-3">
                      <select
                        value={inscricao.status}
                        onChange={(e) => handleStatusChange(inscricao.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-azul-eletrico/30"
                      >
                        <option value="recebida">Recebida</option>
                        <option value="em_analise">Em análise</option>
                        <option value="selecionado">Selecionado</option>
                        <option value="lista_espera">Lista espera</option>
                        <option value="nao_selecionado">Não selecionado</option>
                        <option value="desistente">Desistente</option>
                      </select>
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => {
                          const perguntasExtra = parsePerguntasExtra(projeto?.formulario_extra);
                          const respostasExtra = resolverRespostasExtra(perguntasExtra, inscricao.campos_extra);
                          const detail = JSON.stringify({
                            protocolo: inscricao.protocolo,
                            nome: inscricao.nome_completo,
                            email: inscricao.email,
                            telefone: inscricao.telefone,
                            curso: inscricao.curso,
                            turma: inscricao.turma,
                            semestre: inscricao.semestre,
                            justificativa: inscricao.justificativa,
                            experiencia: inscricao.experiencia_previa,
                            ...(respostasExtra.length > 0 ? {
                              perguntas_do_projeto: Object.fromEntries(respostasExtra.map((r) => [r.pergunta, r.resposta])),
                            } : {}),
                          }, null, 2);
                          alert(detail);
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
