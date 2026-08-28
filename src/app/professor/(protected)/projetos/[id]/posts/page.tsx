'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronRight, FileText, Plus, Pencil, Trash2, Eye, EyeOff,
  ArrowLeft, Save, X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { listPosts, createPost, updatePost, deletePost, getProjetoDetalhes } from '@/actions/professor';
import { formatDateShort } from '@/lib/utils';
import { Prisma } from '@prisma/client';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RichTextEditor } from '@/components/ui/RichTextEditor';

const isConteudoVazio = (html: string) => html.replace(/<[^>]*>/g, '').trim().length === 0;

type Post = Prisma.PostGetPayload<{}>;

export default function ProfessorPostsPage({ params }: { params: { id: string } }) {
  const { user } = useAuth();
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [projetoNome, setProjetoNome] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [form, setForm] = useState({ titulo: '', conteudo: '', resumo: '', status: 'RASCUNHO' as 'RASCUNHO' | 'PUBLICADO' });
  const [saving, setSaving] = useState(false);
  const [deletePostId, setDeletePostId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user?.email) return;
    getProjetoDetalhes(params.id, user.email).then((p) => {
      if (!p) { router.replace('/professor'); return; }
      setProjetoNome(p.nome);
      return listPosts(params.id, user.email!);
    }).then((result) => {
      if (result && 'data' in result && Array.isArray(result.data)) setPosts(result.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, [user, params.id, router]);

  const resetForm = () => {
    setForm({ titulo: '', conteudo: '', resumo: '', status: 'RASCUNHO' });
    setEditingPost(null);
    setShowForm(false);
  };

  const handleEdit = (post: Post) => {
    setForm({ titulo: post.titulo, conteudo: post.conteudo, resumo: post.resumo || '', status: post.status });
    setEditingPost(post);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!user?.email || !form.titulo.trim() || isConteudoVazio(form.conteudo)) return;
    setSaving(true);
    try {
      if (editingPost) {
        const result = await updatePost(editingPost.id, form, user.email);
        if (result.ok) {
          setPosts((prev) => prev.map((p) => p.id === editingPost.id ? { ...p, ...form } : p));
        }
      } else {
        const result = await createPost(params.id, form, user.email);
        if (result.ok) {
          const updated = await listPosts(params.id, user.email);
          if (updated && 'data' in updated && Array.isArray(updated.data)) setPosts(updated.data);
        }
      }
      resetForm();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (postId: string) => {
    setDeletePostId(postId);
  };

  const confirmDelete = async () => {
    if (!deletePostId || !user?.email) return;
    setDeleting(true);
    const result = await deletePost(deletePostId, user.email);
    if (result.ok) {
      setPosts((prev) => prev.filter((p) => p.id !== deletePostId));
    }
    setDeleting(false);
    setDeletePostId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400 text-sm">Carregando posts...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/professor" className="hover:text-azul-eletrico transition-colors">Dashboard</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link href="/professor/projetos" className="hover:text-azul-eletrico transition-colors">Projetos</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link href={`/professor/projetos/${params.id}`} className="hover:text-azul-eletrico transition-colors">{projetoNome}</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-gray-900 font-medium">Posts</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Posts do Projeto</h1>
          <p className="text-gray-500 text-sm mt-1">{projetoNome} — {posts.length} post(s)</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-azul-eletrico text-white rounded-xl font-medium text-sm hover:bg-azul-eletrico/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Post
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">{editingPost ? 'Editar Post' : 'Novo Post'}</h2>
              <button onClick={resetForm} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
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
                  placeholder="Título do post"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Resumo (opcional)</label>
                <input
                  type="text"
                  value={form.resumo}
                  onChange={(e) => setForm({ ...form, resumo: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico"
                  placeholder="Breve resumo do post"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Conteúdo</label>
                <RichTextEditor value={form.conteudo} onChange={(html) => setForm({ ...form, conteudo: html })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setForm({ ...form, status: 'RASCUNHO' })}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                      form.status === 'RASCUNHO' ? 'bg-gray-200 text-gray-900' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    Rascunho
                  </button>
                  <button
                    onClick={() => setForm({ ...form, status: 'PUBLICADO' })}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                      form.status === 'PUBLICADO' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    Publicado
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.titulo.trim() || isConteudoVazio(form.conteudo)}
                className="flex items-center gap-2 px-4 py-2 bg-azul-eletrico text-white rounded-xl text-sm font-medium hover:bg-azul-eletrico/90 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Posts List */}
      {posts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 text-center py-16">
          <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 font-medium">Nenhum post criado</p>
          <p className="text-gray-400 text-sm mt-1">Crie o primeiro post do seu projeto</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div key={post.id} className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-gray-900 truncate">{post.titulo}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      post.status === 'PUBLICADO' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {post.status === 'PUBLICADO' ? 'Publicado' : 'Rascunho'}
                    </span>
                  </div>
                  {post.resumo && <p className="text-gray-500 text-sm mb-2">{post.resumo}</p>}
                  <p className="text-gray-400 text-xs">
                    Criado em {formatDateShort(post.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleEdit(post)}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-azul-eletrico transition-colors"
                    title="Editar"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(post.id)}
                    className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                    title="Excluir"
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
        open={!!deletePostId}
        title="Excluir post?"
        description="Esta ação é irreversível. O post será excluído permanentemente."
        confirmLabel="Excluir post"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeletePostId(null)}
      />
    </div>
  );
}
