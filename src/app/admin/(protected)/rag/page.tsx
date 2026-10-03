'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import {
  ChevronRight, Upload, FileText, Trash2, Eye, EyeOff,
  Plus, Search, AlertCircle, FileUp, X, Save, Edit2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  listDocumentosKb, createDocumentoKbFromText, deleteDocumentoKb,
  toggleDocumentoKb, updateDocumentoKbTitulo,
} from '@/actions/rag';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type DocMetadata = { resumo?: string; categoria?: string; tags?: string[] };
type ChunkMetadata = { qualidade?: 'ok' | 'curto'; tabela_reformatada?: string };

type RagDoc = {
  id: string;
  titulo: string;
  tipo: string;
  status: string;
  ativo: boolean;
  versao: number;
  totalChunks: number;
  totalPaginas: number | null;
  erro: string | null;
  metadata: DocMetadata | null;
  createdAt: Date;
};

type RagDocFull = RagDoc & {
  chunks: Array<{
    id: string;
    texto: string;
    secao: string | null;
    categoria: string | null;
    chunkIndex: number;
    metadata: ChunkMetadata | null;
  }>;
};

const TIPOS_DOC = [
  { value: 'documento_livre', label: 'Documento livre' },
  { value: 'manual', label: 'Manual' },
  { value: 'procedimento', label: 'Procedimento' },
  { value: 'faq', label: 'FAQ' },
  { value: 'outro', label: 'Outro' },
];

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  uploaded: { label: 'Enviado', className: 'bg-gray-100 text-gray-600' },
  extracting: { label: 'Extraindo', className: 'bg-amber-100 text-amber-700' },
  processing: { label: 'Curadoria IA em andamento', className: 'bg-amber-100 text-amber-700' },
  chunking: { label: 'Aguardando indexação', className: 'bg-amber-100 text-amber-700' },
  embedding: { label: 'Gerando embeddings', className: 'bg-amber-100 text-amber-700' },
  indexing: { label: 'Indexando', className: 'bg-amber-100 text-amber-700' },
  indexed: { label: 'Indexado', className: 'bg-green-100 text-green-700' },
  failed: { label: 'Falhou', className: 'bg-red-100 text-red-700' },
};

export default function AdminRagPage() {
  const { user, isMasterAdmin } = useAuth();
  const [docs, setDocs] = useState<RagDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<RagDocFull | null>(null);
  const [form, setForm] = useState({ titulo: '', conteudo: '', tipo: 'documento_livre' });
  const [uploadForm, setUploadForm] = useState({ titulo: '', tipo: 'documento_livre' });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [editingTitulo, setEditingTitulo] = useState('');
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isMasterAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-gray-500">Acesso restrito a administradores.</p>
      </div>
    );
  }

  useEffect(() => {
    loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  const loadDocs = async () => {
    if (!user?.email) return;
    const result = await listDocumentosKb(user.email);
    if (result.ok && 'data' in result && Array.isArray(result.data)) {
      setDocs(result.data as RagDoc[]);
    }
    setLoading(false);
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadForm.titulo.trim() || !user?.email) {
      setError('Arquivo e título são obrigatórios');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('titulo', uploadForm.titulo);
      formData.append('tipo', uploadForm.tipo);
      formData.append('adminEmail', user.email);

      const response = await fetch('/api/admin/rag/upload', { method: 'POST', body: formData });
      const result = await response.json();

      if (result.ok) {
        setUploadForm({ titulo: '', tipo: 'documento_livre' });
        setUploadFile(null);
        setShowUpload(false);
        await loadDocs();
      } else {
        setError(result.error || 'Erro ao enviar arquivo');
      }
    } catch {
      setError('Erro ao enviar arquivo');
    } finally {
      setSaving(false);
    }
  };

  const handleTextUpload = async () => {
    if (!form.titulo.trim() || !form.conteudo.trim() || !user?.email) {
      setError('Título e conteúdo são obrigatórios');
      return;
    }

    setSaving(true);
    setError('');

    const result = await createDocumentoKbFromText(form, user.email);
    if (result.ok) {
      setForm({ titulo: '', conteudo: '', tipo: 'documento_livre' });
      setShowForm(false);
      await loadDocs();
    } else {
      setError(result.error);
    }
    setSaving(false);
  };

  const handleDelete = (docId: string) => setDeleteDocId(docId);

  const confirmDelete = async () => {
    if (!deleteDocId || !user?.email) return;
    setDeleting(true);
    const result = await deleteDocumentoKb(deleteDocId, user.email);
    if (result.ok) {
      setDocs((prev) => prev.filter((d) => d.id !== deleteDocId));
      if (selectedDoc?.id === deleteDocId) {
        setShowDetail(false);
        setSelectedDoc(null);
      }
    }
    setDeleting(false);
    setDeleteDocId(null);
  };

  const handleToggle = async (docId: string) => {
    if (!user?.email) return;
    const result = await toggleDocumentoKb(docId, user.email);
    if (result.ok && 'data' in result && result.data) {
      setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, ativo: result.data!.ativo } : d));
      if (selectedDoc?.id === docId) {
        setSelectedDoc({ ...selectedDoc, ativo: result.data!.ativo });
      }
    }
  };

  const handleViewDoc = async (docId: string) => {
    if (!user) return;
    // Identidade vai no header (token verificado no servidor) — antes era o
    // e-mail na query, que o servidor aceitava como prova de quem era o admin.
    const idToken = await user.getIdToken();
    const response = await fetch(`/api/admin/rag/docs?id=${docId}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const result = await response.json();
    if (result.ok && result.data) {
      setSelectedDoc(result.data);
      setEditingTitulo(result.data.titulo);
      setShowDetail(true);
    }
  };

  const handleSaveTitulo = async () => {
    if (!selectedDoc || !user?.email || !editingTitulo.trim()) return;
    const result = await updateDocumentoKbTitulo(selectedDoc.id, editingTitulo, user.email);
    if (result.ok) {
      setSelectedDoc({ ...selectedDoc, titulo: editingTitulo.trim() });
      setDocs((prev) => prev.map((d) => d.id === selectedDoc.id ? { ...d, titulo: editingTitulo.trim() } : d));
    }
  };

  const filtered = docs.filter((d) =>
    d.titulo.toLowerCase().includes(search.toLowerCase()) ||
    d.tipo.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400 text-sm">Carregando documentos...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin" className="hover:text-azul-eletrico transition-colors">Admin</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-gray-900 font-medium">Documentos RAG</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Documentos RAG</h1>
          <p className="text-gray-500 text-sm mt-1">Gerencie os documentos que alimentam a IFizinha</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setForm({ titulo: '', conteudo: '', tipo: 'documento_livre' }); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-azul-eletrico text-white rounded-xl font-medium text-sm hover:bg-azul-eletrico/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Texto Direto
          </button>
          <button
            onClick={() => { setUploadForm({ titulo: '', tipo: 'documento_livre' }); setUploadFile(null); setShowUpload(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl font-medium text-sm hover:bg-green-700 transition-colors"
          >
            <FileUp className="w-4 h-4" />
            Upload Arquivo
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-700 text-sm flex-1">{error}</p>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Text Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">Novo Documento (Texto)</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
                <input
                  type="text"
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico"
                  placeholder="Nome do documento"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                <select
                  value={form.tipo}
                  onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico bg-white"
                >
                  {TIPOS_DOC.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Conteúdo</label>
                <textarea
                  value={form.conteudo}
                  onChange={(e) => setForm({ ...form, conteudo: e.target.value })}
                  rows={12}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico resize-none font-mono"
                  placeholder="Cole o conteúdo do documento aqui..."
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleTextUpload}
                disabled={saving || !form.titulo.trim() || !form.conteudo.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-azul-eletrico text-white rounded-xl text-sm font-medium hover:bg-azul-eletrico/90 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">Upload de Documento</h2>
              <button onClick={() => setShowUpload(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
                <input
                  type="text"
                  value={uploadForm.titulo}
                  onChange={(e) => setUploadForm({ ...uploadForm, titulo: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico"
                  placeholder="Nome do documento"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                <select
                  value={uploadForm.tipo}
                  onChange={(e) => setUploadForm({ ...uploadForm, tipo: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico bg-white"
                >
                  {TIPOS_DOC.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Arquivo</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.md,.csv,.xlsx,.xls"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-4 py-8 border-2 border-dashed border-gray-300 rounded-xl text-center hover:border-azul-eletrico hover:bg-azul-eletrico/5 transition-colors"
                >
                  <FileUp className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                  {uploadFile ? (
                    <p className="text-sm text-gray-700 font-medium">{uploadFile.name}</p>
                  ) : (
                    <p className="text-sm text-gray-500">PDF, DOCX, DOC, TXT, MD, CSV ou XLSX (máx. 20MB)</p>
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setShowUpload(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleUpload}
                disabled={saving || !uploadFile || !uploadForm.titulo.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                {saving ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetail && selectedDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="font-bold text-gray-900 truncate">{selectedDoc.titulo}</h2>
              <button onClick={() => { setShowDetail(false); setSelectedDoc(null); }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Status e Tipo */}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  selectedDoc.ativo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {selectedDoc.ativo ? 'Ativo' : 'Inativo'}
                </span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_LABEL[selectedDoc.status]?.className ?? 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABEL[selectedDoc.status]?.label ?? selectedDoc.status}
                </span>
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
                  {selectedDoc.tipo}
                </span>
                <span className="text-sm text-gray-500">v{selectedDoc.versao}</span>
                <span className="text-sm text-gray-500">{selectedDoc.totalChunks} chunks</span>
                {selectedDoc.totalPaginas != null && (
                  <span className="text-sm text-gray-500">{selectedDoc.totalPaginas} página(s)</span>
                )}
              </div>

              {selectedDoc.erro && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                  {selectedDoc.erro}
                </div>
              )}

              {/* Curadoria de IA */}
              {(selectedDoc.metadata?.resumo || selectedDoc.metadata?.tags?.length) ? (
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-purple-700 uppercase tracking-wide">Curadoria IA</span>
                    {selectedDoc.metadata?.categoria && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        {selectedDoc.metadata.categoria}
                      </span>
                    )}
                  </div>
                  {selectedDoc.metadata?.resumo && (
                    <p className="text-sm text-gray-700">{selectedDoc.metadata.resumo}</p>
                  )}
                  {!!selectedDoc.metadata?.tags?.length && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedDoc.metadata.tags.map((t) => (
                        <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-white border border-purple-200 text-purple-700">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Curadoria de IA ainda não disponível para este documento (DeepSeek não configurado ou processamento pendente).</p>
              )}

              {/* Título editável */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Título</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editingTitulo}
                    onChange={(e) => setEditingTitulo(e.target.value)}
                    className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico"
                  />
                  <button
                    onClick={handleSaveTitulo}
                    disabled={!editingTitulo.trim() || editingTitulo === selectedDoc.titulo}
                    className="px-4 py-2 bg-azul-eletrico text-white rounded-xl text-sm font-medium hover:bg-azul-eletrico/90 transition-colors disabled:opacity-50"
                  >
                    Salvar
                  </button>
                </div>
              </div>

              {/* Chunks */}
              {selectedDoc.chunks.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Chunks ({selectedDoc.chunks.length}) — sem embeddings ainda (Etapa 4)
                  </label>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {selectedDoc.chunks.map((chunk) => (
                      <div key={chunk.id} className="bg-gray-50 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs text-gray-400">#{chunk.chunkIndex}</span>
                          {chunk.secao && (
                            <span className="text-xs font-medium text-azul-eletrico">{chunk.secao}</span>
                          )}
                          {chunk.categoria && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">{chunk.categoria}</span>
                          )}
                          {chunk.metadata?.qualidade === 'curto' && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">trecho curto</span>
                          )}
                          {chunk.metadata?.tabela_reformatada && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">tabela</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 line-clamp-3">{chunk.texto.slice(0, 300)}</p>
                        {chunk.metadata?.tabela_reformatada && (
                          <p className="text-xs text-blue-700 mt-1 italic line-clamp-2">
                            {chunk.metadata.tabela_reformatada}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
              <div className="flex gap-2">
                <button
                  onClick={() => handleToggle(selectedDoc.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                    selectedDoc.ativo
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {selectedDoc.ativo ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  {selectedDoc.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button
                  onClick={() => handleDelete(selectedDoc.id)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Excluir
                </button>
              </div>
              <button
                onClick={() => { setShowDetail(false); setSelectedDoc(null); }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="search"
          placeholder="Buscar documentos..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-2xl font-black text-gray-900">{docs.length}</p>
          <p className="text-xs text-gray-500">Documentos</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-2xl font-black text-green-600">{docs.filter((d) => d.ativo).length}</p>
          <p className="text-xs text-gray-500">Ativos</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-2xl font-black text-azul-eletrico">{docs.reduce((acc, d) => acc + d.totalChunks, 0)}</p>
          <p className="text-xs text-gray-500">Chunks</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-2xl font-black text-red-600">{docs.filter((d) => d.status === 'failed').length}</p>
          <p className="text-xs text-gray-500">Com falha</p>
        </div>
      </div>

      {/* Documents List */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 text-center py-16">
          <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 font-medium">Nenhum documento encontrado</p>
          <p className="text-gray-400 text-sm mt-1">Adicione documentos para alimentar a IFizinha</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((doc) => (
            <div key={doc.id} className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => handleViewDoc(doc.id)}
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-bold text-gray-900 truncate hover:text-azul-eletrico">{doc.titulo}</h3>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      {doc.tipo}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      doc.ativo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {doc.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_LABEL[doc.status]?.className ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[doc.status]?.label ?? doc.status}
                    </span>
                  </div>
                  {doc.erro && (
                    <p className="text-red-500 text-sm mb-2 line-clamp-1">{doc.erro}</p>
                  )}
                  {doc.metadata?.resumo && (
                    <p className="text-gray-500 text-sm mb-2 line-clamp-2">{doc.metadata.resumo}</p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>{doc.totalChunks} chunks</span>
                    {doc.totalPaginas != null && <span>{doc.totalPaginas} página(s)</span>}
                    <span>v{doc.versao}</span>
                    {!!doc.metadata?.tags?.length && (
                      <span>{doc.metadata.tags.slice(0, 3).join(', ')}{doc.metadata.tags.length > 3 ? ` +${doc.metadata.tags.length - 3}` : ''}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleViewDoc(doc.id)}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-azul-eletrico transition-colors"
                    title="Ver detalhes"
                    aria-label="Ver detalhes"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggle(doc.id)}
                    className={`p-2 rounded-lg transition-colors ${
                      doc.ativo ? 'hover:bg-green-50 text-green-500' : 'hover:bg-gray-100 text-gray-400'
                    }`}
                    title={doc.ativo ? 'Desativar' : 'Ativar'}
                    aria-label={doc.ativo ? 'Desativar documento' : 'Ativar documento'}
                  >
                    {doc.ativo ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                    title="Excluir"
                    aria-label="Excluir documento"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteDocId}
        title="Excluir documento?"
        description="Esta ação é irreversível. O documento e todos os chunks processados serão excluídos permanentemente."
        confirmLabel="Excluir documento"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteDocId(null)}
      />
    </div>
  );
}
