'use client';

import React, { useEffect, useState, useTransition, Suspense } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Trash2, X, Newspaper, AlertCircle, Filter, ExternalLink, EyeOff, FileCode2, Type } from 'lucide-react';
import { listPosts, createPost, updatePost, deletePost, listProjetos, getDocumentoHtmlDoPost, type PostFormData } from '@/actions/admin';
import { useAuth } from '@/contexts/AuthContext';
import { useSearchParams, useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { PostAnexosUploader } from '@/components/ui/PostAnexosUploader';
import { SeletorDeCapaDoPost } from '@/components/ui/SeletorDeCapaDoPost';
import { CampoUrlDaCapa } from '@/components/ui/CampoUrlDaCapa';
import { DocumentoHtmlUploader, type DocumentoHtmlNoFormulario } from '@/components/ui/DocumentoHtmlUploader';
import { enviarArquivo } from '@/lib/upload-midia';
import { anexosDoJson } from '@/lib/post-midias';
import { chaveDeIconeValida } from '@/lib/post-capa';
import { usePesoDasImagensDoTexto } from '@/lib/use-peso-midias';
import { useMensagemErro } from '@/lib/use-mensagem-erro';

type Post = Awaited<ReturnType<typeof listPosts>>[number];
type Projeto = Awaited<ReturnType<typeof listProjetos>>[number];

const EMPTY: PostFormData = { titulo: '', conteudo: '', resumo: '', imagemUrl: '', videoUrl: '', arquivoPdfUrl: '', linkExterno: '', status: 'RASCUNHO', projetoId: '', anexos: [], icone: null };

function AdminPostsContent() {
  const { user, userRole } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Post | null>(null);
  const [form, setForm] = useState<PostFormData>(EMPTY);
  const [error, setError] = useMensagemErro();
  const [isPending, startTransition] = useTransition();
  const [deletePostId, setDeletePostId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Conteúdo escrito no editor ou vindo de um arquivo .html (ver o painel do professor).
  const [modo, setModo] = useState<'editor' | 'html'>('editor');
  const [documento, setDocumento] = useState<DocumentoHtmlNoFormulario | null>(null);
  const [carregandoDocumento, setCarregandoDocumento] = useState(false);

  // Peso das imagens do texto (vem do servidor: as de posts antigos foram
  // enviadas noutra sessão e o navegador não sabe o tamanho).
  const { bytesDasImagens, calculandoPeso, recalcularPesoDoTexto, resetarPeso } =
    usePesoDasImagensDoTexto(user);

  const queryProjetoId = searchParams.get('projetoId') || '';
  const [filterProjetoId, setFilterProjetoId] = useState(queryProjetoId);

  const load = () => {
    if (user?.email && userRole) {
      listPosts(user.email, userRole).then(setPosts).catch(console.error);
      listProjetos(user.email, userRole).then(setProjetos).catch(console.error);
    }
  };
  useEffect(() => { load(); }, [user, userRole]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY, projetoId: filterProjetoId || (projetos[0]?.id ?? '') });
    setError(''); setPanelOpen(true);
    setModo('editor'); setDocumento(null);
    resetarPeso();
  };

  const openEdit = (post: Post) => {
    setEditing(post);
    setForm({
      titulo: post.titulo,
      conteudo: post.conteudo,
      resumo: post.resumo ?? '',
      imagemUrl: post.imagemUrl ?? '',
      videoUrl: post.videoUrl ?? '',
      arquivoPdfUrl: post.arquivoPdfUrl ?? '',
      linkExterno: post.linkExterno ?? '',
      status: post.status,
      projetoId: post.projetoId,
      anexos: anexosDoJson(post.anexos),
      icone: chaveDeIconeValida(post.icone) ? post.icone : null,
    });
    setError(''); setPanelOpen(true);
    resetarPeso();
    void recalcularPesoDoTexto(post.conteudo);

    setDocumento(null);
    setModo(post.documentoHtml ? 'html' : 'editor');
    // O documento não vem na lista: é buscado só ao editar, para a pré-visualização.
    if (post.documentoHtml && user?.email) {
      setCarregandoDocumento(true);
      getDocumentoHtmlDoPost(post.id, user.email)
        .then((r) => {
          if (!r.ok) setError(r.error, 'Não conseguimos carregar o documento HTML deste post.');
          else if (r.data) setDocumento({ html: r.data.html, nome: r.data.nomeArquivo, bytes: r.data.bytes, alterado: false });
        })
        .catch(() => setError('Não conseguimos carregar o documento HTML deste post.'))
        .finally(() => setCarregandoDocumento(false));
    }
  };

  const handleDelete = (id: string) => {
    setDeletePostId(id);
  };

  const confirmDelete = async () => {
    if (!deletePostId || !user?.email) return;
    setDeleting(true);
    startTransition(async () => {
      const r = await deletePost(deletePostId, user.email!);
      if (r.ok) load(); else setError(r.error, 'Não conseguimos excluir esta publicação. Tente novamente.');
      setDeleting(false);
      setDeletePostId(null);
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!user?.email) { setError('Sua sessão expirou. Entre novamente para publicar.'); return; }
    if (modo === 'html' && !documento) {
      setError('Escolha o arquivo HTML da publicação antes de salvar.');
      return;
    }
    if (modo === 'editor' && form.conteudo.replace(/<[^>]*>/g, '').trim().length === 0) {
      setError('Escreva o texto principal da publicação antes de salvar.');
      return;
    }
    // O documento só viaja quando foi escolhido agora. Voltar para o editor num
    // post que tinha documento remove o documento (`null`).
    const documentoHtml = modo === 'html'
      ? (documento?.alterado ? { html: documento.html, nome: documento.nome } : undefined)
      : (editing?.documentoHtml ? null : undefined);
    const dados: PostFormData = { ...form, documentoHtml };
    startTransition(async () => {
      const r = editing
        ? await updatePost(editing.id, dados, user.email!)
        : await createPost(dados, user.email!);
      if (r.ok) { setPanelOpen(false); load(); } else setError(r.error, 'Não conseguimos salvar a publicação. Tente novamente.');
    });
  };

  const set = (field: keyof PostFormData, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleFilterChange = (val: string) => {
    setFilterProjetoId(val);
    router.replace(val ? `/admin/posts?projetoId=${val}` : '/admin/posts');
  };

  const filteredPosts = posts.filter(p => filterProjetoId ? p.projetoId === filterProjetoId : true);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Posts</h1>
          <p className="text-gray-500 text-sm">{filteredPosts.length} post(s) {filterProjetoId ? 'neste projeto' : 'cadastrado(s)'}</p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          {projetos.length > 0 && (
            <div className="flex items-center gap-2 bg-white border border-gray-200 px-3 py-2 rounded-xl text-sm w-full sm:w-auto">
              <Filter className="w-4 h-4 text-gray-400" />
              <select 
                className="bg-transparent border-none outline-none text-gray-700 w-full"
                value={filterProjetoId}
                onChange={(e) => handleFilterChange(e.target.value)}
              >
                <option value="">Todos os projetos</option>
                {projetos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
          )}
          <button onClick={openNew} className="flex-shrink-0 flex items-center gap-2 bg-ciano-claro text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-ciano-claro/90 transition-all text-sm shadow-sm">
            <Plus className="w-4 h-4" /> Novo Post
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {filteredPosts.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Newspaper className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Nenhum post encontrado</p>
          </div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-gray-50">
              {filteredPosts.map((p) => (
                <div key={p.id} className="p-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{p.titulo}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="text-xs text-gray-500 truncate max-w-[140px]">{p.projeto.nome}</span>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${p.status === 'PUBLICADO' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                        {p.status === 'PUBLICADO' ? 'Publicado' : 'Rascunho'}
                      </span>
                      {p.documentoHtml && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-azul-eletrico/10 text-azul-eletrico">
                          <FileCode2 className="w-3 h-3" /> HTML
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                    {/* Ver o post como o visitante vê. Só para PUBLICADO: a rota
                        pública exige status PUBLICADO, então rascunho daria 404. */}
                    {p.status === 'PUBLICADO' ? (
                      <Link
                        href={`/projetos/${p.projeto.slug}/posts/${p.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-azul-eletrico transition-colors"
                        title="Ver no portal (abre em outra aba)"
                        aria-label="Ver no portal"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Link>
                    ) : (
                      <span className="p-2 text-gray-300" title="Rascunho: aparece no portal só depois de publicado">
                        <EyeOff className="w-4 h-4" />
                      </span>
                    )}
                    <button onClick={() => openEdit(p)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-azul-eletrico transition-colors" aria-label="Editar post">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" aria-label="Excluir post">
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
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Título</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Projeto</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filteredPosts.map((p) => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                        {p.documentoHtml && (
                          <span className="inline-flex items-center gap-1 mr-2 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-azul-eletrico/10 text-azul-eletrico align-middle" title={p.documentoHtml.nomeArquivo ?? 'Documento HTML'}>
                            <FileCode2 className="w-3 h-3" /> HTML
                          </span>
                        )}
                        {p.titulo}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{p.projeto.nome}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${p.status === 'PUBLICADO' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                          {p.status === 'PUBLICADO' ? 'Publicado' : 'Rascunho'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {p.status === 'PUBLICADO' ? (
                            <Link
                              href={`/projetos/${p.projeto.slug}/posts/${p.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-azul-eletrico transition-colors"
                              title="Ver no portal (abre em outra aba)"
                              aria-label="Ver no portal"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                          ) : (
                            <span className="p-1.5 text-gray-300" title="Rascunho: aparece no portal só depois de publicado">
                              <EyeOff className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-azul-eletrico transition-colors" aria-label="Editar post">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" aria-label="Excluir post">
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
              <h2 className="font-bold text-gray-900">{editing ? 'Editar Post' : 'Novo Post'}</h2>
              <button onClick={() => setPanelOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-4">
                {/* Informações Básicas */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-gray-900 border-b pb-2">Informações Básicas</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 md:col-span-1">
                      <label className="label-field">Título <span className="text-red-500">*</span></label>
                      <input className="input-field" value={form.titulo} onChange={(e) => set('titulo', e.target.value)} required />
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <label className="label-field">Projeto <span className="text-red-500">*</span></label>
                      <select className="input-field" value={form.projetoId} onChange={(e) => set('projetoId', e.target.value)} required>
                        <option value="">Selecione um projeto</option>
                        {projetos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <label className="label-field">Status</label>
                      <select className="input-field" value={form.status} onChange={(e) => set('status', e.target.value as PostFormData['status'])}>
                        <option value="RASCUNHO">Rascunho</option>
                        <option value="PUBLICADO">Publicado</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Conteúdo */}
                <div className="space-y-4 pt-2">
                  <h3 className="text-sm font-bold text-gray-900 border-b pb-2">Conteúdo</h3>
                  <div>
                    <label className="label-field">Texto Principal <span className="text-red-500">*</span></label>
                    <div className="flex gap-2 mb-2">
                      <button
                        type="button"
                        onClick={() => setModo('editor')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          modo === 'editor' ? 'bg-ciano-claro text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        <Type className="w-3.5 h-3.5" />
                        Escrever no editor
                      </button>
                      <button
                        type="button"
                        onClick={() => setModo('html')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          modo === 'html' ? 'bg-ciano-claro text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
                            onTituloSugerido={(titulo) => setForm((f) => (f.titulo.trim() ? f : { ...f, titulo: titulo.slice(0, 120) }))}
                          />
                          <p className="text-xs text-gray-400 mt-1">
                            O post aparece no portal com a formatação do arquivo: cores, fontes, imagens e estilos.
                            {editing?.documentoHtml ? ' Se voltar para o editor, o documento é removido ao salvar.' : ''}
                          </p>
                        </>
                      )
                    ) : (
                    <>
                    <RichTextEditor
                      value={form.conteudo}
                      onChange={(html) => {
                        set('conteudo', html);
                        void recalcularPesoDoTexto(html);
                      }}
                      onUploadImage={async (arquivo) => {
                        if (!user) return { ok: false, error: 'Sua sessão expirou. Entre novamente para enviar imagens.' };
                        const idToken = await user.getIdToken();
                        const resultado = await enviarArquivo({ arquivo, idToken, subpasta: form.projetoId || undefined });
                        if (!resultado.ok) return { ok: false, error: resultado.error };
                        return { ok: true, url: resultado.data.url };
                      }}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      O botão de imagem da barra insere a imagem no meio do texto. Imagens e anexos somam no limite de 20 MB do post.
                    </p>
                    </>
                    )}
                  </div>
                  <div>
                    <label className="label-field">Anexos</label>
                    <PostAnexosUploader
                      obterToken={async () => (user ? user.getIdToken() : null)}
                      subpasta={form.projetoId || undefined}
                      anexos={anexosDoJson(form.anexos)}
                      onChange={(anexos) => setForm((f) => ({ ...f, anexos }))}
                      bytesNoTexto={bytesDasImagens}
                      carregandoPeso={calculandoPeso}
                    />
                  </div>
                  <div>
                    <label className="label-field">Resumo <span className="text-gray-400 font-normal text-xs ml-1">(Opcional, usado em cards)</span></label>
                    <textarea className="input-field min-h-[72px] resize-none" value={form.resumo ?? ''} onChange={(e) => set('resumo', e.target.value)} maxLength={200} />
                  </div>
                </div>

                {/* Mídia */}
                <div className="space-y-4 pt-2">
                  <h3 className="text-sm font-bold text-gray-900 border-b pb-2">Mídia</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="label-field">Capa da publicação</label>
                      <SeletorDeCapaDoPost
                        imagemUrl={form.imagemUrl ?? ''}
                        icone={chaveDeIconeValida(form.icone) ? form.icone : null}
                        onImagem={(url) => set('imagemUrl', url)}
                        onIcone={(chave) => setForm((f) => ({ ...f, icone: chave }))}
                        obterToken={async () => (user ? user.getIdToken() : null)}
                        subpasta={form.projetoId || undefined}
                      />
                      <CampoUrlDaCapa
                        imagemUrl={form.imagemUrl ?? ''}
                        onChange={(url) => set('imagemUrl', url)}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="label-field">URL de um Vídeo (YouTube/Vimeo)</label>
                      <input type="url" className="input-field" value={form.videoUrl ?? ''} onChange={(e) => set('videoUrl', e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
                      {form.videoUrl && form.videoUrl.includes('youtube.com/watch?v=') && (
                        <div className="mt-3 aspect-video bg-gray-100 rounded-xl overflow-hidden border border-gray-200">
                          <iframe 
                            width="100%" 
                            height="100%" 
                            src={`https://www.youtube.com/embed/${new URLSearchParams(new URL(form.videoUrl).search).get('v')}`} 
                            title="Video preview" 
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                            allowFullScreen
                          ></iframe>
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <label className="label-field">URL de Arquivo PDF</label>
                      <input type="url" className="input-field" value={form.arquivoPdfUrl ?? ''} onChange={(e) => set('arquivoPdfUrl', e.target.value)} placeholder="https://.../arquivo.pdf" />
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <label className="label-field">Link Externo</label>
                      <input type="url" className="input-field" value={form.linkExterno ?? ''} onChange={(e) => set('linkExterno', e.target.value)} placeholder="https://..." />
                    </div>
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
                <button type="button" onClick={() => setPanelOpen(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-all">Cancelar</button>
                <button type="submit" disabled={isPending || carregandoDocumento} className="flex-1 py-2.5 rounded-xl bg-ciano-claro text-white font-semibold text-sm hover:bg-ciano-claro/90 transition-all disabled:opacity-60">
                  {isPending ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </>
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

export default function AdminPostsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">Carregando posts...</div>}>
      <AdminPostsContent />
    </Suspense>
  );
}
