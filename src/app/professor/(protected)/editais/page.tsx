'use client';

import React, { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Plus, Pencil, Trash2, X, FileText, AlertCircle, Loader2,
  Eye, EyeOff, FileUp, ExternalLink, FolderOpen, Upload,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  listMeusEditais, createMeuEdital, updateMeuEdital, deleteMeuEdital,
  listProjetosParaEdital,
  type EditalFormData,
} from '@/actions/professor';
import { getStatusLabel, getStatusColor, getCategoryColor, formatDateShort } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

/** Editais com o projeto incluído (ver `include` em `listMeusEditais`). */
type Edital = {
  id: string;
  titulo: string;
  slug: string;
  categoria: string;
  resumo: string | null;
  dataEncerramento: Date | null;
  status: string;
  review_status: string;
  linkOficial: string | null;
  arquivoPdfUrl: string | null;
  pdfPath: string | null;
  destaque: boolean;
  traducaoIFizinha: unknown;
};

type ProjetoOpcao = { id: string; nome: string };

const CATEGORIAS = [
  'BOLSAS', 'AUXILIOS', 'EXTENSAO', 'PESQUISA', 'ENSINO',
  'EVENTOS', 'ESTAGIOS', 'RESULTADOS',
];

const STATUS_LIST = [
  'EM_BREVE', 'ABERTO', 'EM_ANALISE', 'RESULTADO_PARCIAL',
  'PRAZO_RECURSO', 'RESULTADO_PUBLICADO', 'ENCERRADO',
];

const EMPTY_TRAD: EditalFormData['traducaoIFizinha'] = {
  oquee: '', quempode: '', beneficios: '', documentos: '',
  comoinscrever: '', prazo: '', observacoes: '',
};

function emptyForm(projetoId = ''): EditalFormData {
  return {
    titulo: '', categoria: 'BOLSAS', resumo: '', dataEncerramento: '',
    status: 'EM_BREVE', linkOficial: '', arquivoPdfUrl: '', pdfPath: '',
    destaque: false, projetoId, traducaoIFizinha: { ...EMPTY_TRAD },
  };
}

export default function ProfessorEditaisPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [editais, setEditais] = useState<Edital[]>([]);
  const [projetos, setProjetos] = useState<ProjetoOpcao[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Edital | null>(null);
  const [form, setForm] = useState<EditalFormData>(emptyForm());
  const [activeTab, setActiveTab] = useState<'info' | 'ifizinha'>('info');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const carregar = async () => {
    if (!user?.email) return;
    const [rEditais, projetosLista] = await Promise.all([
      listMeusEditais(user.email),
      listProjetosParaEdital(user.email),
    ]);
    if (rEditais.ok && 'data' in rEditais && rEditais.data) {
      setEditais(rEditais.data as unknown as Edital[]);
    }
    setProjetos(projetosLista);
  };

  useEffect(() => {
    if (!user?.email) return;
    carregar().catch(console.error).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm(projetos[0]?.id ?? ''));
    setActiveTab('info');
    setError('');
    setPanelOpen(true);
  };

  const openEdit = (edital: Edital) => {
    setEditing(edital);
    const trad = (edital.traducaoIFizinha ?? {}) as EditalFormData['traducaoIFizinha'];
    setForm({
      titulo: edital.titulo,
      categoria: edital.categoria as EditalFormData['categoria'],
      resumo: edital.resumo ?? '',
      dataEncerramento: edital.dataEncerramento
        ? new Date(edital.dataEncerramento).toISOString().split('T')[0]
        : '',
      status: edital.status as EditalFormData['status'],
      linkOficial: edital.linkOficial ?? '',
      arquivoPdfUrl: edital.arquivoPdfUrl ?? '',
      pdfPath: edital.pdfPath ?? '',
      destaque: edital.destaque,
      projetoId: (edital as unknown as { projeto?: { id: string } }).projeto?.id
        ?? (edital as unknown as { projetoId?: string }).projetoId
        ?? '',
      traducaoIFizinha: { ...EMPTY_TRAD, ...trad },
    });
    setActiveTab('info');
    setError('');
    setPanelOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;
    setError('');
    startTransition(async () => {
      const result = editing
        ? await updateMeuEdital(editing.id, form, user.email!)
        : await createMeuEdital(form, user.email!);
      if (result.ok) {
        toast(editing ? 'Edital atualizado' : 'Edital publicado', 'success');
        setPanelOpen(false);
        await carregar();
      } else {
        setError(result.error);
      }
    });
  };

  /**
   * Faz o upload do PDF para o armazenamento local do servidor e guarda no
   * formulário o `pdfPath` (caminho em disco) e a `arquivoPdfUrl` (URL pública
   * servida pelo nginx). O limite de 10 MB é validado no servidor
   * (`src/lib/file-storage.ts`), não aqui — checagem no cliente é só UX.
   */
  const handlePdfSelected = async (file: File | null) => {
    if (!file || !user?.email) return;
    setError('');

    const LIMITE_PDF = 10 * 1024 * 1024;
    if (file.size > LIMITE_PDF) {
      setError(`O PDF tem ${(file.size / 1024 / 1024).toFixed(1)} MB e excede o limite de 10 MB.`);
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('userEmail', user.email);
      if (form.projetoId) fd.append('subpasta', form.projetoId);

      const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        setError(json.error || 'Não foi possível enviar o PDF.');
        return;
      }

      setForm((f) => ({ ...f, pdfPath: json.data.path, arquivoPdfUrl: json.data.url }));
      toast('PDF anexado ao edital', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha de rede ao enviar o PDF.');
    } finally {
      setUploading(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  const handleTogglePublicacao = (edital: Edital) => {
    if (!user?.email) return;
    startTransition(async () => {
      const review_status = edital.review_status === 'PUBLICADO' ? 'RASCUNHO' : 'PUBLICADO';
      const result = await updateMeuEdital(edital.id, { review_status }, user.email!);
      if (result.ok) {
        toast(
          review_status === 'PUBLICADO' ? 'Edital publicado' : 'Edital despublicado',
          'success'
        );
        await carregar();
      } else {
        setError(result.error);
      }
    });
  };

  const confirmDelete = async () => {
    if (!deleteId || !user?.email) return;
    setDeleting(true);
    const result = await deleteMeuEdital(deleteId, user.email);
    if (result.ok) {
      toast('Edital excluído', 'success');
      await carregar();
    } else {
      setError(result.error);
    }
    setDeleting(false);
    setDeleteId(null);
  };

  const setTrad = (field: string, value: string) =>
    setForm((f) => ({ ...f, traducaoIFizinha: { ...f.traducaoIFizinha, [field]: value } }));

  /** URL pública do PDF servida pelo nginx — `/files/...` */
  const pdfPublico = form.arquivoPdfUrl || '';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Meus Editais</h1>
          <p className="text-gray-500 text-sm">
            Publique e gerencie os editais dos seus projetos. O edital publicado aparece
            imediatamente em <Link href="/editais" className="text-azul-eletrico font-semibold hover:underline">/editais</Link>.
          </p>
        </div>
        <button
          onClick={openNew}
          disabled={projetos.length === 0}
          title={projetos.length === 0 ? 'Você precisa coordenar ao menos um projeto' : undefined}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-azul-eletrico text-white text-sm font-semibold hover:bg-azul-eletrico/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" />
          Novo Edital
        </button>
      </div>

      {error && !panelOpen && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {projetos.length === 0 && !loading && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 text-amber-800 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Você não coordena nenhum projeto, então não há a quem vincular um edital.
            Fale com o Administrador Geral para ser vinculado a um projeto.
          </span>
        </div>
      )}

      {/* Lista */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h2 className="font-bold text-gray-900">Editais ({editais.length})</h2>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Carregando editais...</div>
        ) : editais.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Nenhum edital cadastrado</p>
            <p className="text-sm mt-1">Clique em &ldquo;Novo Edital&rdquo; para publicar o primeiro.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                  <th className="px-5 py-3 font-medium">Edital</th>
                  <th className="px-5 py-3 font-medium">Projeto</th>
                  <th className="px-5 py-3 font-medium">Categoria</th>
                  <th className="px-5 py-3 font-medium">Encerra</th>
                  <th className="px-5 py-3 font-medium">Situação</th>
                  <th className="px-5 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {editais.map((edital) => (
                  <tr key={edital.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900">{edital.titulo}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {edital.review_status !== 'PUBLICADO' && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">
                            Rascunho
                          </span>
                        )}
                        {edital.arquivoPdfUrl && (
                          <a
                            href={edital.arquivoPdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-azul-eletrico hover:underline inline-flex items-center gap-1"
                          >
                            <FileText className="w-3 h-3" /> PDF
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      {(edital as unknown as { projeto?: { nome: string } }).projeto?.nome ?? (
                        <span className="text-gray-400">Institucional</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${getCategoryColor(edital.categoria)}`}>
                        {edital.categoria}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {edital.dataEncerramento ? formatDateShort(edital.dataEncerramento) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${getStatusColor(edital.status)}`}>
                        {getStatusLabel(edital.status)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleTogglePublicacao(edital)}
                          disabled={isPending}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                          title={edital.review_status === 'PUBLICADO' ? 'Despublicar' : 'Publicar'}
                        >
                          {edital.review_status === 'PUBLICADO'
                            ? <EyeOff className="w-4 h-4" />
                            : <Eye className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => openEdit(edital)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(edital.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                          title="Excluir"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Painel do formulário */}
      {panelOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setPanelOpen(false)}>
          <div
            className="bg-white rounded-2xl w-full max-w-2xl my-8 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900 text-lg">
                {editing ? 'Editar Edital' : 'Novo Edital'}
              </h3>
              <button onClick={() => setPanelOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Abas */}
            <div className="flex gap-1 border-b border-gray-100 mb-4">
              {([['info', 'Informações'], ['ifizinha', 'Tradução IFizinha']] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setActiveTab(k)}
                  className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                    activeTab === k
                      ? 'border-azul-eletrico text-azul-eletrico'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-100 text-red-700 rounded-xl px-3 py-2 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {activeTab === 'info' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Projeto <span className="text-red-500">*</span>
                    </label>
                    <select
                      className="input-field"
                      value={form.projetoId ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, projetoId: e.target.value }))}
                      required
                    >
                      <option value="">Selecione o projeto...</option>
                      {projetos.map((p) => (
                        <option key={p.id} value={p.id}>{p.nome}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">
                      Só aparecem projetos que você coordena.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Título <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      value={form.titulo}
                      onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
                      placeholder="Ex: EDITAL Nº 01/2026 — BOLSAS DE EXTENSÃO"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                      <select
                        className="input-field"
                        value={form.categoria}
                        onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value as EditalFormData['categoria'] }))}
                      >
                        {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Situação</label>
                      <select
                        className="input-field"
                        value={form.status}
                        onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as EditalFormData['status'] }))}
                      >
                        {STATUS_LIST.map((s) => (
                          <option key={s} value={s}>{getStatusLabel(s)}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Resumo <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      className="input-field min-h-[80px]"
                      value={form.resumo}
                      onChange={(e) => setForm((f) => ({ ...f, resumo: e.target.value }))}
                      placeholder="Resumo objetivo para a listagem pública (2-4 frases)."
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Encerramento das inscrições <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        className="input-field"
                        value={form.dataEncerramento}
                        onChange={(e) => setForm((f) => ({ ...f, dataEncerramento: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Link oficial <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="url"
                        className="input-field"
                        value={form.linkOficial}
                        onChange={(e) => setForm((f) => ({ ...f, linkOficial: e.target.value }))}
                        placeholder="https://..."
                        required
                      />
                    </div>
                  </div>

                  {/* Upload do PDF — armazenamento local no servidor (10 MB) */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      PDF do edital <span className="text-gray-400 font-normal">(até 10 MB)</span>
                    </label>
                    <div className="border border-dashed border-gray-200 rounded-xl p-4">
                      {pdfPublico ? (
                        <div className="flex items-center justify-between gap-3">
                          <a
                            href={pdfPublico}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-azul-eletrico hover:underline min-w-0"
                          >
                            <FileText className="w-4 h-4 flex-shrink-0" />
                            <span className="truncate">{pdfPublico.split('/').pop()}</span>
                            <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                          </a>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => pdfInputRef.current?.click()}
                              className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                            >
                              Trocar
                            </button>
                            <button
                              type="button"
                              onClick={() => setForm((f) => ({ ...f, pdfPath: '', arquivoPdfUrl: '' }))}
                              className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600"
                            >
                              Remover
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => pdfInputRef.current?.click()}
                          disabled={uploading}
                          className="w-full flex flex-col items-center gap-2 py-3 text-gray-500 hover:text-azul-eletrico transition-colors disabled:opacity-60"
                        >
                          {uploading ? (
                            <>
                              <Loader2 className="w-6 h-6 animate-spin" />
                              <span className="text-sm">Enviando PDF...</span>
                            </>
                          ) : (
                            <>
                              <Upload className="w-6 h-6" />
                              <span className="text-sm font-medium">Selecionar PDF</span>
                              <span className="text-xs text-gray-400">
                                O arquivo fica guardado no servidor do portal
                              </span>
                            </>
                          )}
                        </button>
                      )}
                      <input
                        ref={pdfInputRef}
                        type="file"
                        accept="application/pdf,.pdf"
                        className="hidden"
                        onChange={(e) => handlePdfSelected(e.target.files?.[0] ?? null)}
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={form.destaque ?? false}
                      onChange={(e) => setForm((f) => ({ ...f, destaque: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    Destacar na página de editais
                  </label>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                    Estes campos são o &ldquo;A IFizinha Explica&rdquo;: a versão em linguagem simples que
                    aparece para o estudante na página do edital. Todos são opcionais.
                  </p>

                  {([
                    ['oquee', 'O que é'],
                    ['quempode', 'Quem pode participar'],
                    ['beneficios', 'Benefícios'],
                    ['documentos', 'Documentos necessários'],
                    ['comoinscrever', 'Como se inscrever'],
                    ['prazo', 'Prazos'],
                    ['observacoes', 'Observações'],
                  ] as const).map(([key, label]) => (
                    <div key={key}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                      <textarea
                        className="input-field min-h-[60px]"
                        value={form.traducaoIFizinha[key] ?? ''}
                        onChange={(e) => setTrad(key, e.target.value)}
                      />
                    </div>
                  ))}
                </>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending || uploading}
                  className="flex-1 py-2.5 rounded-xl bg-azul-eletrico text-white font-semibold text-sm hover:bg-azul-eletrico/90 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editing ? 'Salvar alterações' : 'Publicar edital'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Excluir edital"
        description="Esta ação não pode ser desfeita. O PDF anexado também será removido do servidor."
        confirmLabel={deleting ? 'Excluindo...' : 'Excluir'}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
