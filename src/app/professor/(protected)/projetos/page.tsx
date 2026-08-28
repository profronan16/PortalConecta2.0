'use client';

import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  FolderOpen, Plus, Pencil, Trash2, X, Users, ChevronRight,
  Search, TrendingUp, AlertCircle, Save,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { listMyProjetos, updateMyProjeto, type MyProjetoFormData } from '@/actions/professor';
import { getStatusLabel, getStatusColor, formatDateShort } from '@/lib/utils';
import { FormularioExtraEditor } from '@/components/ui/FormularioExtraEditor';
import { parsePerguntasExtra, type PerguntaExtra } from '@/lib/formulario-extra';

type Projeto = Awaited<ReturnType<typeof listMyProjetos>>[number];

const STATUS_LIST = ['ATIVO', 'EM_EXECUCAO', 'ENCERRADO', 'SUSPENSO', 'INSCRICOES_ABERTAS', 'SEM_VAGAS'];

export default function ProfessorProjetosPage() {
  const { user } = useAuth();
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Projeto | null>(null);
  const [form, setForm] = useState<MyProjetoFormData>({
    nome: '', coordenador: '', area: '', descricao: '',
    status: 'EM_EXECUCAO', corPrimaria: '#2F52D3',
    email: '', instagram: '', site: '', formularioExtra: [],
  });
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const load = () => {
    if (!user?.email) return;
    listMyProjetos(user.email)
      .then(setProjetos)
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
      status: projeto.status,
      corPrimaria: projeto.corPrimaria,
      email: projeto.email ?? '',
      instagram: projeto.instagram ?? '',
      site: projeto.site ?? '',
      formularioExtra: parsePerguntasExtra(projeto.formulario_extra),
    });
    setError('');
    setPanelOpen(true);
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
      } else {
        setError(result.error);
      }
    });
  };

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
          <h1 className="text-2xl font-black text-gray-900">Meus Projetos</h1>
          <p className="text-gray-500 text-sm">{projetos.length} projeto(s) que você coordena</p>
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
                className="h-20 relative flex items-end p-4"
                style={{ background: `linear-gradient(135deg, ${projeto.corPrimaria} 0%, ${projeto.corPrimaria}cc 100%)` }}
              >
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-white font-black text-xl border border-white/30">
                  {projeto.nome.charAt(0)}
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
                <p className="text-sm text-gray-500 mb-3 line-clamp-2">{projeto.descricao}</p>

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

                {/* Ações */}
                <div className="flex gap-2">
                  <button
                    onClick={() => openEdit(projeto)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Editar
                  </button>
                  <Link
                    href={`/professor/projetos/${projeto.id}`}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-azul-eletrico text-white text-sm font-medium hover:bg-azul-eletrico/90 transition-all"
                  >
                    Ver detalhes
                    <ChevronRight className="w-3.5 h-3.5" />
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
          <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-white z-50 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">Editar Projeto</h2>
              <button onClick={() => setPanelOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-4">
                <Field label="Nome" required>
                  <input className="input-field" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} required />
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Área" required>
                    <input className="input-field" value={form.area} onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))} required />
                  </Field>
                  <Field label="Status" required>
                    <select className="input-field" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as MyProjetoFormData['status'] }))}>
                      {STATUS_LIST.map((s) => <option key={s} value={s}>{getStatusLabel(s)}</option>)}
                    </select>
                  </Field>
                </div>

                <Field label="Coordenador">
                  <input className="input-field" value={form.coordenador} onChange={(e) => setForm((f) => ({ ...f, coordenador: e.target.value }))} />
                </Field>

                <Field label="Descrição">
                  <textarea className="input-field min-h-[100px] resize-none" value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} />
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Cor principal">
                    <input type="color" className="input-field h-10 p-1 cursor-pointer" value={form.corPrimaria} onChange={(e) => setForm((f) => ({ ...f, corPrimaria: e.target.value }))} />
                  </Field>
                  <Field label="Email">
                    <input type="email" className="input-field" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Instagram">
                    <input className="input-field" value={form.instagram} onChange={(e) => setForm((f) => ({ ...f, instagram: e.target.value }))} placeholder="@usuario" />
                  </Field>
                  <Field label="Site">
                    <input type="url" className="input-field" value={form.site} onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))} />
                  </Field>
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
