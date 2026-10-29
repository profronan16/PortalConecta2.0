'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronRight, FileText, Plus, Pencil, Trash2, Eye, EyeOff, ExternalLink,
  ArrowLeft, Save, X, FileCode2, Type,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { listPosts, createPost, updatePost, deletePost, getProjetoParaConteudo, getDocumentoHtmlDoPost } from '@/actions/professor';
import { formatDateShort } from '@/lib/utils';
import { Prisma } from '@prisma/client';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { PostAnexosUploader } from '@/components/ui/PostAnexosUploader';
import { SeletorDeCapaDoPost } from '@/components/ui/SeletorDeCapaDoPost';
import { PostCapa } from '@/components/ui/PostCapa';
import { DocumentoHtmlUploader, type DocumentoHtmlNoFormulario } from '@/components/ui/DocumentoHtmlUploader';
import { useToast } from '@/components/ui/toast';
import { enviarArquivo } from '@/lib/upload-midia';
import { anexosDoJson, type MidiaDoPost } from '@/lib/post-midias';
import { chaveDeIconeValida, type ChaveIconePost } from '@/lib/post-capa';
import { usePesoDasImagensDoTexto } from '@/lib/use-peso-midias';

const isConteudoVazio = (html: string) => html.replace(/<[^>]*>/g, '').trim().length === 0;

type Post = Prisma.PostGetPayload<{ include: { documentoHtml: { select: { nomeArquivo: true; bytes: true } } } }>;

/** Como o conteúdo do post é feito: no editor de texto ou com um arquivo .html. */
type ModoConteudo = 'editor' | 'html';

export default function ProfessorPostsPage({ params }: { params: { id: string } }) {
  const { user, userRole } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const somenteGestor = userRole === 'ESTUDANTE';
  const [posts, setPosts] = useState<Post[]>([]);
  const [projetoNome, setProjetoNome] = useState('');
  // O slug do projeto entra na URL pública do post (/projetos/<slug>/posts/<slug>).
  const [projetoSlug, setProjetoSlug] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [form, setForm] = useState({
    titulo: '',
    conteudo: '',
    resumo: '',
    status: 'RASCUNHO' as 'RASCUNHO' | 'PUBLICADO',
    imagemUrl: '',
    icone: null as ChaveIconePost | null,
    anexos: [] as MidiaDoPost[],
  });
  const [modo, setModo] = useState<ModoConteudo>('editor');
  const [documento, setDocumento] = useState<DocumentoHtmlNoFormulario | null>(null);
  const [carregandoDocumento, setCarregandoDocumento] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletePostId, setDeletePostId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Peso das imagens que estão DENTRO do texto (vem do servidor: elas podem ter
  // sido enviadas noutra sessão e o navegador não sabe o tamanho).
  const { bytesDasImagens, calculandoPeso, recalcularPesoDoTexto, resetarPeso } =
    usePesoDasImagensDoTexto(user);

  useEffect(() => {
    if (!user?.email) return;
    getProjetoParaConteudo(params.id, user.email).then((p) => {
      if (!p) { router.replace(somenteGestor ? '/professor/projetos' : '/professor'); return; }
      setProjetoNome(p.nome);
      setProjetoSlug(p.slug);
      return listPosts(params.id, user.email!);
    }).then((result) => {
      if (result && 'data' in result && Array.isArray(result.data)) setPosts(result.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, [user, params.id, router, somenteGestor]);

  const resetForm = () => {
    setForm({ titulo: '', conteudo: '', resumo: '', status: 'RASCUNHO', imagemUrl: '', icone: null, anexos: [] });
    setEditingPost(null);
    setShowForm(false);
    setModo('editor');
    setDocumento(null);
    resetarPeso();
  };

  const recarregarPosts = async () => {
    if (!user?.email) return;
    const updated = await listPosts(params.id, user.email);
    if (updated && 'data' in updated && Array.isArray(updated.data)) setPosts(updated.data);
  };

  const handleEdit = (post: Post) => {
    setForm({
      titulo: post.titulo,
      conteudo: post.conteudo,
      resumo: post.resumo || '',
      status: post.status,
      imagemUrl: post.imagemUrl ?? '',
      icone: chaveDeIconeValida(post.icone) ? post.icone : null,
      anexos: anexosDoJson(post.anexos),
    });
    setEditingPost(post);
    setShowForm(true);
    resetarPeso();
    void recalcularPesoDoTexto(post.conteudo);

    setDocumento(null);
    setModo(post.documentoHtml ? 'html' : 'editor');
    // O documento não vem na lista (pode ter centenas de KB): é buscado só ao
    // editar, para a pré-visualização.
    if (post.documentoHtml && user?.email) {
      setCarregandoDocumento(true);
      getDocumentoHtmlDoPost(post.id, user.email)
        .then((resultado) => {
          if (!resultado.ok) toast(resultado.error, 'error');
          else if (resultado.data) {
            setDocumento({ html: resultado.data.html, nome: resultado.data.nomeArquivo, bytes: resultado.data.bytes, alterado: false });
          }
        })
        .catch(() => toast('Não conseguimos carregar o documento HTML deste post.', 'error'))
        .finally(() => setCarregandoDocumento(false));
    }
  };

  // No modo HTML o texto vem do arquivo; no editor, do que foi digitado.
  const conteudoPronto = modo === 'html' ? !!documento : !isConteudoVazio(form.conteudo);

  const handleSave = async () => {
    if (!user?.email || !form.titulo.trim() || !conteudoPronto) return;
    setSaving(true);
    try {
      // O documento só viaja quando foi escolhido agora. Voltar para o editor num
      // post que tinha documento remove o documento (`null`).
      const documentoHtml = modo === 'html'
        ? (documento?.alterado ? { html: documento.html, nome: documento.nome } : undefined)
        : (editingPost?.documentoHtml ? null : undefined);
      const dados = { ...form, documentoHtml };

      const result = editingPost
        ? await updatePost(editingPost.id, dados, user.email)
        : await createPost(params.id, dados, user.email);

      // O erro do servidor precisa aparecer: é ele que recusa o post acima de
      // 20 MB (a checagem da tela é só um aviso antecipado).
      if (!result.ok) {
        toast(result.error || 'Não conseguimos salvar o post. Tente novamente.', 'error');
        return;
      }

      await recarregarPosts();
      toast(editingPost ? 'Post atualizado.' : 'Post publicado no projeto.', 'success');
      resetForm();
    } catch (e) {
      console.error(e);
      toast('Não conseguimos salvar o post. Confira sua conexão e tente novamente.', 'error');
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
        <Link href={somenteGestor ? `/professor/projetos/${params.id}/pagina` : `/professor/projetos/${params.id}`} className="hover:text-azul-eletrico transition-colors">{projetoNome}</Link>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Capa</label>
                <SeletorDeCapaDoPost
                  imagemUrl={form.imagemUrl}
                  icone={form.icone}
                  onImagem={(url) => setForm((atual) => ({ ...atual, imagemUrl: url }))}
                  onIcone={(chave) => setForm((atual) => ({ ...atual, icone: chave }))}
                  obterToken={async () => (user ? user.getIdToken() : null)}
                  subpasta={params.id}
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
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setModo('editor')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      modo === 'editor' ? 'bg-azul-eletrico text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <Type className="w-3.5 h-3.5" />
                    Escrever no editor
                  </button>
                  <button
                    type="button"
                    onClick={() => setModo('html')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      modo === 'html' ? 'bg-azul-eletrico text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <FileCode2 className="w-3.5 h-3.5" />
                    Enviar arquivo HTML
                  </button>
                </div>
                {modo === 'html' ? (
                  carregandoDocumento ? (
                    <p className="text-sm text-gray-400 py-6 text-center">Carregando documento...</p>
                  ) : (
                    <>
                      <DocumentoHtmlUploader
                        documento={documento}
                        onChange={setDocumento}
                        onTituloSugerido={(titulo) => setForm((atual) => (atual.titulo.trim() ? atual : { ...atual, titulo: titulo.slice(0, 120) }))}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        O post aparece no portal com a formatação do arquivo: cores, fontes, imagens e estilos.
                        {editingPost?.documentoHtml ? ' Se voltar para o editor, o documento é removido ao salvar.' : ''}
                      </p>
                    </>
                  )
                ) : (
                <>
                <RichTextEditor
                  value={form.conteudo}
                  onChange={(html) => {
                    setForm((atual) => ({ ...atual, conteudo: html }));
                    void recalcularPesoDoTexto(html);
                  }}
                  onUploadImage={async (arquivo) => {
                    if (!user) return { ok: false, error: 'Sua sessão expirou. Entre novamente para enviar imagens.' };
                    const idToken = await user.getIdToken();
                    const resultado = await enviarArquivo({ arquivo, idToken, subpasta: params.id });
                    if (!resultado.ok) return { ok: false, error: resultado.error };
                    return { ok: true, url: resultado.data.url };
                  }}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Use o botão de imagem da barra para inserir imagens no meio do texto. Elas contam no limite de 20 MB do post.
                </p>
                </>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Anexos</label>
                <PostAnexosUploader
                  obterToken={async () => (user ? user.getIdToken() : null)}
                  subpasta={params.id}
                  anexos={form.anexos}
                  onChange={(anexos) => setForm((atual) => ({ ...atual, anexos }))}
                  bytesNoTexto={bytesDasImagens}
                  carregandoPeso={calculandoPeso}
                />
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
                disabled={saving || carregandoDocumento || !form.titulo.trim() || !conteudoPronto}
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
                {/* Mesma capa que o aluno vê no portal: imagem, ícone escolhido
                    ou o padrão — assim o professor confere antes de publicar. */}
                <div className="w-20 h-14 flex-shrink-0">
                  <PostCapa post={post} tamanho="compact" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-gray-900 truncate">{post.titulo}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      post.status === 'PUBLICADO' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {post.status === 'PUBLICADO' ? 'Publicado' : 'Rascunho'}
                    </span>
                    {post.documentoHtml && (
                      <span
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-azul-eletrico/10 text-azul-eletrico"
                        title={post.documentoHtml.nomeArquivo ?? undefined}
                      >
                        <FileCode2 className="w-3 h-3" />
                        HTML
                      </span>
                    )}
                  </div>
                  {post.resumo && <p className="text-gray-500 text-sm mb-2">{post.resumo}</p>}
                  <p className="text-gray-400 text-xs">
                    Criado em {formatDateShort(post.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {/* Ver o post como o estudante vê. O link só existe para post
                      PUBLICADO: rascunho não tem página pública (a rota exige
                      status PUBLICADO), então mostrar o botão levaria a um 404. */}
                  {post.status === 'PUBLICADO' && projetoSlug ? (
                    <Link
                      href={`/projetos/${projetoSlug}/posts/${post.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-azul-eletrico transition-colors"
                      title="Ver no portal (abre em outra aba)"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Link>
                  ) : (
                    <span
                      className="p-2 text-gray-300"
                      title="Rascunho: aparece no portal só depois de publicado"
                    >
                      <EyeOff className="w-4 h-4" />
                    </span>
                  )}
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
