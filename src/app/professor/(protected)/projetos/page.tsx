'use client';

import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  FolderOpen, Plus, Pencil, Trash2, X, Users, ChevronRight,
  Search, TrendingUp, AlertCircle, Save, ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { listMyProjetos, listProjetosQueGerencio, updateMyProjeto, getEquipeDoProjeto, type MyProjetoFormData } from '@/actions/professor';
import type { EquipeDoProjeto } from '@/lib/projetos-equipe';
import { getStatusLabel, getStatusColor, formatDateShort } from '@/lib/utils';
import { FormularioExtraEditor } from '@/components/ui/FormularioExtraEditor';
import { parsePerguntasExtra, type PerguntaExtra } from '@/lib/formulario-extra';
import {
  AVISO_CAMPOS_SUAP,
  camposBloqueadosParaEdicao,
  descreverCamposIgnorados,
} from '@/lib/projetos-edicao';
import { useToast } from '@/components/ui/toast';
import { useMensagemErro } from '@/lib/use-mensagem-erro';
import { LogoDoProjeto } from '@/components/projetos/LogoDoProjeto';
import { CamposDeApresentacaoDoProjeto } from '@/components/projetos/CamposDeApresentacaoDoProjeto';
import { EquipeEFinanciamentoDoProjeto } from '@/components/projetos/EquipeEFinanciamentoDoProjeto';
import { estiloDaCapa } from '@/lib/projeto-midia';
import { textoSimples } from '@/lib/texto';

type Projeto = Awaited<ReturnType<typeof listMyProjetos>>[number];

const STATUS_LIST = ['ATIVO', 'EM_EXECUCAO', 'ENCERRADO', 'SUSPENSO', 'INSCRICOES_ABERTAS', 'SEM_VAGAS'];

export default function ProfessorProjetosPage() {
  const { user, userRole } = useAuth();
  const { toast } = useToast();
  const somenteGestor = userRole === 'ESTUDANTE';
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Projeto | null>(null);
  const [form, setForm] = useState<MyProjetoFormData>({
    nome: '', coordenador: '', area: '', descricao: '', resumoCurto: '',
    status: 'EM_EXECUCAO', corPrimaria: '#2F52D3',
    logoUrl: '', bannerUrl: '',
    email: '', instagram: '', site: '', formularioExtra: [],
    financiamento: [], viceCoordenadorNome: '', viceCoordenadorEmail: '',
  });
  // Estudantes do projeto = inscrições selecionadas que aceitaram a convocação.
  const [equipe, setEquipe] = useState<EquipeDoProjeto | null>(null);
  const [error, setError] = useMensagemErro();
  const [isPending, startTransition] = useTransition();

  const load = () => {
    if (!user?.email) return;
    Promise.all([
      listMyProjetos(user.email),
      listProjetosQueGerencio(user.email),
    ])
      .then(([coordenados, geridos]) => {
        // Quem é gestor pode ter os dois vínculos; o Map evita duplicar.
        const mapa = new Map<string, Projeto>();
        for (const p of [...coordenados, ...geridos]) mapa.set(p.id, p);
        setProjetos([...mapa.values()]);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [user]);

  const filtered = projetos.filter((p) =>
    p.nome.toLowerCase().includes(search.toLowerCase()) ||
    p.area.toLowerCase().includes(search.toLowerCase())
  );

  const openEdit = (projeto: Projeto) => {
    setEditing(projeto);
    setForm({
      nome: projeto.nome,
      coordenador: projeto.coordenador,
      area: projeto.area,
      descricao: projeto.descricao ?? '',
      resumoCurto: projeto.resumoCurto ?? '',
      status: projeto.status,
      corPrimaria: projeto.corPrimaria,
      logoUrl: projeto.logoUrl ?? '',
      bannerUrl: projeto.bannerUrl ?? '',
      email: projeto.email ?? '',
      instagram: projeto.instagram ?? '',
      site: projeto.site ?? '',
      financiamento: projeto.financiamento ?? [],
      viceCoordenadorNome: projeto.viceCoordenadorNome ?? '',
      viceCoordenadorEmail: projeto.viceCoordenadorEmail ?? '',
      formularioExtra: parsePerguntasExtra(projeto.formulario_extra),
    });
    setError('');
    setPanelOpen(true);
    setEquipe(null);
    if (user?.email) {
      getEquipeDoProjeto(projeto.id, user.email)
        .then((e) => setEquipe(e ?? { bolsistas: [], voluntarios: [], total: 0 }))
        .catch(console.error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !user?.email) return;
    setError('');
    startTransition(async () => {
      const result = await updateMyProjeto(editing.id, form, user.email ?? undefined);
      if (result.ok) {
        setPanelOpen(false);
        load();
        // O servidor ignora campos institucionais de projetos do SUAP (2.10).
        const ignorados = result.data?.ignorados ?? [];
        if (ignorados.length > 0) {
          toast(
            `Alterações salvas. Sem efeito (dados do SUAP): ${descreverCamposIgnorados(ignorados)}.`,
            'info',
          );
        }
      } else {
        setError(result.error, 'Não conseguimos salvar o projeto. Confira os campos e tente novamente.');
      }
    });
  };

  // Campos institucionais bloqueados no projeto em edição (vazio se for manual).
  const bloqueados = editing ? camposBloqueadosParaEdicao(editing) : [];
  const estaBloqueado = (campo: string) => bloqueados.includes(campo as never);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500 text-sm">Carregando projetos...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">
            {somenteGestor ? 'Projetos que gerencio' : 'Meus Projetos'}
          </h1>
          <p className="text-gray-500 text-sm">
            {somenteGestor
              ? `${projetos.length} projeto(s) em que você é gestor da página`
              : `${projetos.length} projeto(s) que você coordena`}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="search"
          placeholder="Buscar projetos..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico focus:border-transparent"
        />
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="font-medium text-lg">Nenhum projeto encontrado</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((projeto) => (
            <div
              key={projeto.id}
              className="bg-white rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-lg transition-all duration-300 overflow-hidden"
            >
              {/* Color header */}
              <div
                className="h-20 relative flex items-end p-4 overflow-hidden"
                style={estiloDaCapa(projeto.corPrimaria, projeto.bannerUrl)}
              >
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-white font-black text-xl border border-white/30 overflow-hidden">
                  <LogoDoProjeto nome={projeto.nome} logoUrl={projeto.logoUrl} />
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-white/80 text-xs bg-black/20 rounded-full px-2.5 py-1 font-medium">
                    {getStatusLabel(projeto.status)}
                  </span>
                </div>
              </div>

              <div className="p-5">
                <h3 className="font-bold text-gray-900 text-base leading-snug mb-1">
                  {projeto.nome}
                </h3>
                <p className="text-sm text-gray-500 mb-3 line-clamp-2">{textoSimples(projeto.descricao)}</p>

                <div className="flex items-center justify-between mb-4">
                  <span
                    className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: projeto.corPrimaria }}
                  >
                    {projeto.area}
                  </span>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {projeto._count?.inscricoes ?? 0} inscritos
                    </span>
                  </div>
                </div>

                {/* Ações: três caminhos diferentes, com nomes que dizem para onde vão.
                    "Gerenciar" = inscrições/vagas/posts (área do professor);
                    "Ver no portal" = a página pública, o que o estudante vê. */}
                <div className="flex gap-2">
                  {!somenteGestor && (
                    <button
                      onClick={() => openEdit(projeto)}
                      title="Editar os dados do projeto"
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Editar
                    </button>
                  )}
                  <Link
                    href={
                      somenteGestor
                        ? `/professor/projetos/${projeto.id}/pagina`
                        : `/professor/projetos/${projeto.id}`
                    }
                    title={somenteGestor ? 'Editar a página e os posts do projeto' : 'Inscrições, vagas e posts do projeto'}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-azul-eletrico text-white text-sm font-medium hover:bg-azul-eletrico/90 transition-all"
                  >
                    {somenteGestor ? 'Editar página' : 'Gerenciar'}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
                <div className="flex gap-2 mt-2">
                  <Link
                    href={`/projetos/${projeto.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir a página pública do projeto (como o estudante vê)"
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-gray-200 text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Ver no portal
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Slide-in panel */}
      {panelOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setPanelOpen(false)} />
          <div className="fixed top-0 right-0 h-full w-full max-w-2xl bg-white z-50 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">Editar Projeto</h2>
              <button onClick={() => setPanelOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-4">
                {bloqueados.length > 0 && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800 text-xs">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      {AVISO_CAMPOS_SUAP}
                      <br />
                      Você continua podendo editar descrição, cor, contatos, links e o formulário de inscrição.
                    </span>
                  </div>
                )}

                <Field label="Nome" required={!estaBloqueado('nome')}>
                  <input
                    className={`input-field ${estaBloqueado('nome') ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                    value={form.nome}
                    onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                    disabled={estaBloqueado('nome')}
                    required={!estaBloqueado('nome')}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Área" required={!estaBloqueado('area')}>
                    <input
                      className={`input-field ${estaBloqueado('area') ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                      value={form.area}
                      onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                      disabled={estaBloqueado('area')}
                      required={!estaBloqueado('area')}
                    />
                  </Field>
                  <Field label="Status" required={!estaBloqueado('status')}>
                    <select
                      className={`input-field ${estaBloqueado('status') ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                      value={form.status}
                      onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as MyProjetoFormData['status'] }))}
                      disabled={estaBloqueado('status')}
                    >
                      {STATUS_LIST.map((s) => <option key={s} value={s}>{getStatusLabel(s)}</option>)}
                    </select>
                  </Field>
                </div>

                <Field label="Coordenador">
                  <input
                    className={`input-field ${estaBloqueado('coordenador') ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
                    value={form.coordenador}
                    onChange={(e) => setForm((f) => ({ ...f, coordenador: e.target.value }))}
                    disabled={estaBloqueado('coordenador')}
                  />
                </Field>

                {editing && (
                  <CamposDeApresentacaoDoProjeto
                    nome={form.nome || editing.nome}
                    valores={form}
                    subpasta={editing.id}
                    onChange={(campo, valor) =>
                      setForm((f) => ({ ...f, [campo]: valor }))
                    }
                  />
                )}

                {/* Vice, estudantes (das inscrições) e financiamento: aparecem na
                    página pública junto ao resumo. Mesmo bloco das outras telas. */}
                <div className="pt-2 space-y-4">
                  <EquipeEFinanciamentoDoProjeto
                    valores={form}
                    onChange={(alteracao) => setForm((f) => ({ ...f, ...alteracao }))}
                    equipe={equipe}
                    podeEditarVice={!somenteGestor}
                  />
                </div>

                <div className="pt-2">
                  <div className="border-b pb-2 mb-3">
                    <h3 className="text-sm font-bold text-gray-900">Formulário de Inscrição</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Perguntas extras exibidas no formulário público de inscrição do seu projeto, além dos campos padrão (nome, e-mail, curso etc.).
                    </p>
                  </div>
                  <FormularioExtraEditor
                    value={form.formularioExtra ?? []}
                    onChange={(v: PerguntaExtra[]) => setForm((f) => ({ ...f, formularioExtra: v }))}
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-xs">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    {error}
                  </div>
                )}
              </div>

              <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4 flex gap-3">
                <button type="button" onClick={() => setPanelOpen(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-all">
                  Cancelar
                </button>
                <button type="submit" disabled={isPending} className="flex-1 py-2.5 rounded-xl bg-azul-eletrico text-white font-semibold text-sm hover:bg-azul-eletrico/90 transition-all disabled:opacity-60 flex items-center justify-center gap-1.5">
                  {isPending ? 'Salvando...' : <><Save className="w-4 h-4" /> Salvar</>}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
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
