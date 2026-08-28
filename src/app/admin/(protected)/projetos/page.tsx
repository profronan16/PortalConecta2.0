'use client';

import React, { useEffect, useState, useTransition, useMemo } from 'react';
import { Plus, Pencil, Trash2, X, FolderOpen, AlertCircle, ExternalLink, Newspaper, Search, Eye, EyeOff, UserCheck, UserX, Loader2 } from 'lucide-react';
import { listProjetos, createProjeto, updateProjeto, deleteProjeto, toggleProjetoPublicacao, type ProjetoFormData } from '@/actions/admin';
import { toggleInscricoes, abrirInscricoes } from '@/actions/professor';
import { AbrirInscricoesModal } from '@/components/ui/AbrirInscricoesModal';
import { FormularioExtraEditor } from '@/components/ui/FormularioExtraEditor';
import { parsePerguntasExtra, type PerguntaExtra } from '@/lib/formulario-extra';
import { getStatusLabel, getStatusColor } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type Projeto = Awaited<ReturnType<typeof listProjetos>>[number];

const STATUS_LIST = ['ATIVO','EM_EXECUCAO','ENCERRADO','SUSPENSO','INSCRICOES_ABERTAS','SEM_VAGAS'];
const TIPO_LIST = ['Pesquisa', 'Extensão'];

const EMPTY_FORM: ProjetoFormData = {
  nome: '', coordenador: '', coordenadorEmail: '', viceCoordenadorNome: '', viceCoordenadorEmail: '', area: '', descricao: '',
  dataInicio: '', servidores: '', alunos: '', observacao: '',
  status: 'EM_EXECUCAO', logoUrl: '', corPrimaria: '#2F52D3',
  email: '', instagram: '', site: '', destaque: false, adminEmails: '', formularioExtra: [],
};

export default function AdminProjetosPage() {
  const { user, userRole, isMasterAdmin } = useAuth();
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Projeto | null>(null);
  const [form, setForm] = useState<ProjetoFormData>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [abrirModalProjetoId, setAbrirModalProjetoId] = useState<string | null>(null);
  const [togglingInscricoesId, setTogglingInscricoesId] = useState<string | null>(null);

  // ── Filtros ──
  const [searchNome, setSearchNome] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const filteredProjetos = useMemo(() => {
    return projetos.filter((p) => {
      const matchNome = !searchNome || p.nome.toLowerCase().includes(searchNome.toLowerCase());
      const matchTipo = !filterTipo || p.area === filterTipo;
      const matchStatus = !filterStatus || p.status === filterStatus;
      return matchNome && matchTipo && matchStatus;
    });
  }, [projetos, searchNome, filterTipo, filterStatus]);

  const hasFilter = searchNome || filterTipo || filterStatus;
  const clearFilters = () => { setSearchNome(''); setFilterTipo(''); setFilterStatus(''); };

  const load = () => {
    if (user?.email && userRole) {
      listProjetos(user.email, userRole).then(setProjetos).catch(console.error);
    }
  };
  useEffect(() => { load(); }, [user, userRole]);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError('');
    setPanelOpen(true);
  };

  const openEdit = (projeto: Projeto) => {
    setEditing(projeto);
    setForm({
      nome: projeto.nome,
      coordenador: projeto.coordenador,
      coordenadorEmail: projeto.coordenadorEmail ?? '',
      viceCoordenadorNome: projeto.viceCoordenadorNome ?? '',
      viceCoordenadorEmail: projeto.viceCoordenadorEmail ?? '',
      area: projeto.area,
      descricao: projeto.descricao ?? '',
      dataInicio: projeto.dataInicio ? new Date(projeto.dataInicio).toISOString().split('T')[0] : '',
      servidores: projeto.servidores ?? '',
      alunos: projeto.alunos ?? '',
      observacao: projeto.observacao ?? '',
      status: projeto.status,
      logoUrl: projeto.logoUrl ?? '',
      corPrimaria: projeto.corPrimaria,
      email: projeto.email ?? '',
      instagram: projeto.instagram ?? '',
      site: projeto.site ?? '',
      destaque: projeto.destaque,
      adminEmails: projeto.admins.map(a => a.email).join(', '),
      formularioExtra: parsePerguntasExtra(projeto.formulario_extra),
    });
    setError('');
    setPanelOpen(true);
  };

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  const handleTogglePublicacao = (id: string) => {
    if (!user?.email) return;
    startTransition(async () => {
      const result = await toggleProjetoPublicacao(id, user.email!);
      if (result.ok) load();
      else setError(result.error);
    });
  };

  // Mesma action que o professor coordenador usa (src/actions/professor.ts)
  // — já permite o Administrador Geral por causa de `temAcessoAoProjeto`,
  // só faltava um jeito de acioná-la fora do /professor (rota que o ADMIN
  // nem consegue acessar, ver admin/(protected)/layout.tsx).
  const handleToggleInscricoes = (projeto: Projeto) => {
    if (!user?.email) return;
    // Abrir exige configurar o prazo primeiro (pop-up); fechar não precisa.
    if (!projeto.inscricoes_abertas) {
      setAbrirModalProjetoId(projeto.id);
      return;
    }

    // Atualização otimista: muda o ícone na hora (sem esperar o servidor) e
    // só corrige a linha afetada em memória — em vez de `load()`, que
    // recarregava TODOS os projetos com TODAS as colunas de novo (listProjetos
    // não usa `select`), fazendo o botão parecer travado. Reverte se falhar.
    setTogglingInscricoesId(projeto.id);
    setProjetos((prev) => prev.map((p) =>
      p.id === projeto.id ? { ...p, inscricoes_abertas: false, status: 'ATIVO' } : p
    ));

    toggleInscricoes(projeto.id, user.email)
      .then((result) => {
        if (!result.ok) {
          setProjetos((prev) => prev.map((p) =>
            p.id === projeto.id ? { ...p, inscricoes_abertas: true, status: 'INSCRICOES_ABERTAS' } : p
          ));
          setError(result.error);
        }
      })
      .finally(() => setTogglingInscricoesId(null));
  };

  const handleConfirmAbrirInscricoes = async (data: { inscricaoInicio?: string; inscricaoFim: string }) => {
    if (!abrirModalProjetoId || !user?.email) return;
    const result = await abrirInscricoes(abrirModalProjetoId, user.email, data);
    if (result.ok) {
      setProjetos((prev) => prev.map((p) =>
        p.id === abrirModalProjetoId ? { ...p, inscricoes_abertas: true, status: 'INSCRICOES_ABERTAS' } : p
      ));
      setAbrirModalProjetoId(null);
    } else {
      setError(result.error);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId || !user?.email) return;
    setDeleting(true);
    startTransition(async () => {
      const result = await deleteProjeto(deleteId, user.email!);
      if (result.ok) load();
      else setError(result.error);
      setDeleting(false);
      setDeleteId(null);
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!user?.email) { setError('Não autenticado'); return; }
    startTransition(async () => {
      const result = editing ? await updateProjeto(editing.id, form, user.email!) : await createProjeto(form, user.email!);
      if (result.ok) { setPanelOpen(false); load(); }
      else setError(result.error);
    });
  };

  const set = (field: keyof ProjetoFormData, value: unknown) =>
    setForm((f) => ({ ...f, [field]: value }));

  const isMaster = userRole === 'ADMIN' || isMasterAdmin;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Projetos</h1>
          <p className="text-gray-500 text-sm">
            {hasFilter
              ? <>{filteredProjetos.length} de {projetos.length} projeto(s)</>
              : <>{projetos.length} projeto(s) cadastrado(s)</>
            }
          </p>
        </div>
        {(userRole === 'ADMIN' || isMasterAdmin) && (
          <button onClick={openNew} className="flex items-center gap-2 bg-roxo-luminoso text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-roxo-luminoso/90 transition-all text-sm shadow-sm">
            <Plus className="w-4 h-4" /> Novo Projeto
          </button>
        )}
      </div>

      {/* ── Barra de Filtros ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-3 mb-4 flex flex-wrap gap-2 items-center">
        {/* Busca por nome */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nome..."
            value={searchNome}
            onChange={(e) => setSearchNome(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-roxo-luminoso/30 focus:border-roxo-luminoso transition-all"
          />
        </div>

        {/* Filtro por Tipo */}
        <select
          value={filterTipo}
          onChange={(e) => setFilterTipo(e.target.value)}
          className="py-2 px-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-roxo-luminoso/30 focus:border-roxo-luminoso transition-all text-gray-600 bg-white"
        >
          <option value="">Todos os tipos</option>
          {TIPO_LIST.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* Filtro por Status */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="py-2 px-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-roxo-luminoso/30 focus:border-roxo-luminoso transition-all text-gray-600 bg-white"
        >
          <option value="">Todos os status</option>
          {STATUS_LIST.map((s) => (
            <option key={s} value={s}>{getStatusLabel(s)}</option>
          ))}
        </select>

        {/* Limpar filtros */}
        {hasFilter && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all border border-gray-200"
          >
            <X className="w-3.5 h-3.5" />
            Limpar
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {filteredProjetos.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">
              {hasFilter ? 'Nenhum projeto encontrado com esses filtros' : 'Nenhum projeto cadastrado ainda'}
            </p>
            {hasFilter && (
              <button onClick={clearFilters} className="mt-3 text-sm text-roxo-luminoso hover:underline">
                Limpar filtros
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-gray-50">
              {filteredProjetos.map((p) => (
                <div key={p.id} className="p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ backgroundColor: p.corPrimaria }}>
                    {p.nome.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{p.nome}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                        p.area === 'Pesquisa' ? 'bg-azul-eletrico/10 text-azul-eletrico'
                        : p.area === 'Extensão' ? 'bg-roxo-luminoso/10 text-roxo-luminoso'
                        : 'text-gray-500'
                      }`}>{p.area || '—'}</span>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusColor(p.status)}`}>
                        {getStatusLabel(p.status)}
                      </span>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                        p.review_status === 'PUBLICADO' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {p.review_status === 'PUBLICADO' ? 'Publicado' : 'Rascunho'}
                      </span>
                      {p.destaque && <span className="text-xs bg-dourado-500/20 text-dourado-700 px-2 py-0.5 rounded-full font-semibold">Destaque</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isMaster && (
                      <button
                        onClick={() => handleTogglePublicacao(p.id)}
                        className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-green-600 transition-colors"
                        title={p.review_status === 'PUBLICADO' ? 'Despublicar' : 'Publicar'}
                      >
                        {p.review_status === 'PUBLICADO' ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    )}
                    {isMaster && (
                      <button
                        onClick={() => handleToggleInscricoes(p)}
                        disabled={togglingInscricoesId === p.id}
                        className={`p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-60 disabled:cursor-wait ${p.inscricoes_abertas ? 'text-green-600' : 'text-gray-400 hover:text-green-600'}`}
                        title={p.inscricoes_abertas ? 'Fechar inscrições' : 'Abrir inscrições'}
                      >
                        {togglingInscricoesId === p.id
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : p.inscricoes_abertas ? <UserCheck className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                      </button>
                    )}
                    <a href={`/admin/posts?projetoId=${p.id}`} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-ciano-claro transition-colors" title="Gerenciar Posts">
                      <Newspaper className="w-4 h-4" />
                    </a>
                    <a href={`/projetos/${p.slug}`} target="_blank" className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-azul-eletrico transition-colors" title="Ver página do projeto">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <button onClick={() => openEdit(p)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-azul-eletrico transition-colors" aria-label="Editar projeto">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" aria-label="Excluir projeto">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Projeto</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Tipo</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Publicação</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Destaque</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filteredProjetos.map((p) => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: p.corPrimaria }}>
                            {p.nome.charAt(0)}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900 truncate max-w-[200px]">{p.nome}</p>
                            <p className="text-xs text-gray-500 truncate max-w-[200px]">{p.coordenador}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                          p.area === 'Pesquisa'
                            ? 'bg-azul-eletrico/10 text-azul-eletrico border-azul-eletrico/20'
                            : p.area === 'Extensão'
                            ? 'bg-roxo-luminoso/10 text-roxo-luminoso border-roxo-luminoso/20'
                            : 'bg-gray-100 text-gray-600 border-gray-200'
                        }`}>
                          {p.area || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusColor(p.status)}`}>
                          {getStatusLabel(p.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                          p.review_status === 'PUBLICADO' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {p.review_status === 'PUBLICADO' ? 'Publicado' : 'Rascunho'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {p.destaque && <span className="text-xs bg-dourado-500/20 text-dourado-700 px-2 py-0.5 rounded-full font-semibold">Destaque</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {isMaster && (
                            <button
                              onClick={() => handleTogglePublicacao(p.id)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-green-600 transition-colors"
                              title={p.review_status === 'PUBLICADO' ? 'Despublicar' : 'Publicar'}
                            >
                              {p.review_status === 'PUBLICADO' ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          {isMaster && (
                            <button
                              onClick={() => handleToggleInscricoes(p)}
                              disabled={togglingInscricoesId === p.id}
                              className={`p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-60 disabled:cursor-wait ${p.inscricoes_abertas ? 'text-green-600' : 'text-gray-400 hover:text-green-600'}`}
                              title={p.inscricoes_abertas ? 'Fechar inscrições' : 'Abrir inscrições'}
                            >
                              {togglingInscricoesId === p.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : p.inscricoes_abertas ? <UserCheck className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          <a href={`/admin/posts?projetoId=${p.id}`} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-ciano-claro transition-colors" title="Gerenciar Posts">
                            <Newspaper className="w-3.5 h-3.5" />
                          </a>
                          <a href={`/projetos/${p.slug}`} target="_blank" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-azul-eletrico transition-colors" title="Ver página do projeto">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                          <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-azul-eletrico transition-colors" aria-label="Editar projeto">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" aria-label="Excluir projeto">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {panelOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setPanelOpen(false)} />
          <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-white z-50 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">{editing ? 'Editar Projeto' : 'Novo Projeto'}</h2>
              <button onClick={() => setPanelOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {/* Informações Básicas */}
                  <div className="col-span-2 space-y-4">
                    <h3 className="text-sm font-bold text-gray-900 border-b pb-2">Informações Básicas</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2">
                        <label className="label-field">Nome <span className="text-red-500">*</span></label>
                        <input className="input-field disabled:opacity-50 disabled:bg-gray-50" value={form.nome} onChange={(e) => set('nome', e.target.value)} required disabled={!isMaster} />
                      </div>
                      <div>
                        <label className="label-field">Coordenador <span className="text-red-500">*</span></label>
                        <input className="input-field disabled:opacity-50 disabled:bg-gray-50" value={form.coordenador} onChange={(e) => set('coordenador', e.target.value)} required disabled={!isMaster} />
                      </div>
                      <div>
                        <label className="label-field">E-mail do coordenador</label>
                        <input type="email" className="input-field disabled:opacity-50 disabled:bg-gray-50" placeholder="coordenador@ifpr.edu.br" value={form.coordenadorEmail ?? ''} onChange={(e) => set('coordenadorEmail', e.target.value)} disabled={!isMaster} />
                        <p className="text-xs text-gray-400 mt-1">Precisa ser @ifpr.edu.br para o coordenador acessar o Painel do Professor deste projeto.</p>
                      </div>
                      <div>
                        <label className="label-field">Vice-coordenador (nome)</label>
                        <input className="input-field disabled:opacity-50 disabled:bg-gray-50" value={form.viceCoordenadorNome ?? ''} onChange={(e) => set('viceCoordenadorNome', e.target.value)} disabled={!isMaster} />
                      </div>
                      <div>
                        <label className="label-field">Vice-coordenador (e-mail)</label>
                        <input type="email" className="input-field disabled:opacity-50 disabled:bg-gray-50" placeholder="vice@ifpr.edu.br" value={form.viceCoordenadorEmail ?? ''} onChange={(e) => set('viceCoordenadorEmail', e.target.value)} disabled={!isMaster} />
                      </div>
                      <div>
                        <label className="label-field">Área <span className="text-red-500">*</span></label>
                        <input className="input-field disabled:opacity-50 disabled:bg-gray-50" value={form.area} onChange={(e) => set('area', e.target.value)} required disabled={!isMaster} />
                      </div>
                      <div>
                        <label className="label-field">Status <span className="text-red-500">*</span></label>
                        <select className="input-field disabled:opacity-50 disabled:bg-gray-50" value={form.status} onChange={(e) => set('status', e.target.value as ProjetoFormData['status'])} disabled={!isMaster}>
                          {STATUS_LIST.map((s) => <option key={s} value={s}>{getStatusLabel(s)}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="label-field">Data de Início</label>
                        <input type="date" className="input-field" value={form.dataInicio ?? ''} onChange={(e) => set('dataInicio', e.target.value)} />
                      </div>
                      <div className="col-span-2">
                        <label className="label-field">Descrição</label>
                        <textarea className="input-field min-h-[80px] resize-none" value={form.descricao ?? ''} onChange={(e) => set('descricao', e.target.value)} />
                      </div>
                    </div>
                  </div>

                  {/* Equipe do Projeto */}
                  <div className="col-span-2 space-y-4 mt-2">
                    <h3 className="text-sm font-bold text-gray-900 border-b pb-2">Equipe do Projeto</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2">
                        <label className="label-field">Servidores</label>
                        <textarea className="input-field min-h-[60px]" value={form.servidores ?? ''} onChange={(e) => set('servidores', e.target.value)} placeholder="Nomes dos servidores envolvidos" />
                      </div>
                      <div className="col-span-2">
                        <label className="label-field">Alunos</label>
                        <textarea className="input-field min-h-[60px]" value={form.alunos ?? ''} onChange={(e) => set('alunos', e.target.value)} placeholder="Nomes dos alunos envolvidos" />
                      </div>
                    </div>
                  </div>

                  {/* Identidade Visual */}
                  <div className="col-span-2 space-y-4 mt-2">
                    <h3 className="text-sm font-bold text-gray-900 border-b pb-2">Identidade Visual</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="label-field">Cor primária</label>
                        <div className="flex items-center gap-2">
                          <input type="color" value={form.corPrimaria ?? '#2F52D3'} onChange={(e) => set('corPrimaria', e.target.value)} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5 shrink-0" />
                          <input className="input-field flex-1 uppercase font-mono text-sm" value={form.corPrimaria ?? ''} onChange={(e) => set('corPrimaria', e.target.value)} />
                        </div>
                      </div>
                      <div>
                        <label className="label-field">Logo URL</label>
                        <input type="url" className="input-field" value={form.logoUrl ?? ''} onChange={(e) => set('logoUrl', e.target.value)} placeholder="https://..." />
                      </div>
                      {form.logoUrl && (
                        <div className="col-span-2 flex justify-center p-4 bg-gray-50 rounded-xl border border-gray-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={form.logoUrl} alt="Preview Logo" className="max-h-24 object-contain" onError={(e) => (e.currentTarget.style.display = 'none')} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Contato e Redes */}
                  <div className="col-span-2 space-y-4 mt-2">
                    <h3 className="text-sm font-bold text-gray-900 border-b pb-2">Contato e Redes</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="label-field">E-mail</label>
                        <input type="email" className="input-field" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="contato@projeto.com" />
                      </div>
                      <div>
                        <label className="label-field">Instagram</label>
                        <input className="input-field" placeholder="@usuario" value={form.instagram ?? ''} onChange={(e) => set('instagram', e.target.value)} />
                      </div>
                      <div className="col-span-2">
                        <label className="label-field">Site Oficial</label>
                        <input type="url" className="input-field" value={form.site ?? ''} onChange={(e) => set('site', e.target.value)} placeholder="https://..." />
                      </div>
                    </div>
                  </div>

                  {/* Configurações Avançadas */}
                  <div className="col-span-2 space-y-4 mt-2">
                    <h3 className="text-sm font-bold text-gray-900 border-b pb-2">Configurações Avançadas</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2">
                        <label className={`flex items-center gap-3 cursor-pointer bg-gray-50 p-3 rounded-xl border border-gray-100 transition-colors ${!isMaster ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}>
                          <input type="checkbox" checked={form.destaque ?? false} onChange={(e) => set('destaque', e.target.checked)} className="w-5 h-5 accent-roxo-luminoso rounded" disabled={!isMaster} />
                          <div>
                            <span className="text-sm font-semibold text-gray-900 block">Destacar na homepage</span>
                            <span className="text-xs text-gray-500">Exibir este projeto com maior relevância na página principal.</span>
                          </div>
                        </label>
                      </div>
                      <div className="col-span-2">
                        <label className="label-field">Observação</label>
                        <textarea className="input-field min-h-[60px]" value={form.observacao ?? ''} onChange={(e) => set('observacao', e.target.value)} placeholder="Anotações internas" />
                      </div>
                      {isMaster && (
                        <div className="col-span-2">
                          <label className="label-field">E-mails da Equipe do Projeto</label>
                          <p className="text-xs text-gray-500 mb-2">Insira os e-mails separados por vírgula. Estas pessoas poderão gerenciar posts deste projeto.</p>
                          <textarea className="input-field min-h-[60px] resize-y" placeholder="exemplo@email.com, outro@email.com" value={form.adminEmails ?? ''} onChange={(e) => set('adminEmails', e.target.value)} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Formulário de Inscrição */}
                  <div className="col-span-2 space-y-3 mt-2">
                    <div className="border-b pb-2">
                      <h3 className="text-sm font-bold text-gray-900">Formulário de Inscrição</h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Perguntas extras exibidas no formulário público de inscrição, além dos campos padrão (nome, e-mail, curso etc.).
                      </p>
                    </div>
                    <FormularioExtraEditor
                      value={form.formularioExtra ?? []}
                      onChange={(v: PerguntaExtra[]) => set('formularioExtra', v)}
                    />
                  </div>
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
                <button type="submit" disabled={isPending} className="flex-1 py-2.5 rounded-xl bg-roxo-luminoso text-white font-semibold text-sm hover:bg-roxo-luminoso/90 transition-all disabled:opacity-60">
                  {isPending ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Excluir projeto?"
        description="Esta ação é irreversível. O projeto e todos os dados associados serão excluídos permanentemente."
        confirmLabel="Excluir projeto"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />

      {abrirModalProjetoId && (
        <AbrirInscricoesModal
          onClose={() => setAbrirModalProjetoId(null)}
          onConfirm={handleConfirmAbrirInscricoes}
        />
      )}
    </div>
  );
}
