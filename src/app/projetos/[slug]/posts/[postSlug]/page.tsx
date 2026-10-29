import React, { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, Calendar, ArrowLeft, FileText, ExternalLink, Video, FileArchive, Download } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { stripHtml } from '@/lib/rich-text';
import { anexosDoJson, formatarMb } from '@/lib/post-midias';
import { semCapaEscolhida } from '@/lib/post-capa';
import { PostCapa } from '@/components/ui/PostCapa';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { DocumentoHtmlDoPost } from '@/components/ui/DocumentoHtmlDoPost';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

type Params = { slug: string; postSlug: string };

/** Anexos são PDF ou pacotes (ZIP/RAR) — muda só o ícone. */
function ehPacote(nome: string): boolean {
  const minusculo = nome.toLowerCase();
  return minusculo.endsWith('.zip') || minusculo.endsWith('.rar');
}

// `cache`: `generateMetadata` e a página pedem o mesmo post — sem isto o
// documento HTML (que pode ter alguns MB) sairia do banco duas vezes.
const getPost = cache(async (slug: string, postSlug: string) => {
  return prisma.post.findFirst({
    where: { slug: postSlug, status: 'PUBLICADO', projeto: { slug } },
    include: {
      projeto: { select: { nome: true, slug: true, corPrimaria: true } },
      author: { select: { name: true } },
      documentoHtml: { select: { html: true } },
    },
  });
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const post = await getPost(params.slug, params.postSlug);
  if (!post) return { title: 'Post não encontrado' };

  const descricao = (post.resumo || stripHtml(post.conteudo)).slice(0, 160);
  return {
    title: post.titulo,
    description: descricao,
    alternates: { canonical: `/projetos/${post.projeto.slug}/posts/${post.slug}` },
    openGraph: {
      type: 'article',
      title: post.titulo,
      description: descricao,
      // Capa do post quando existe; senão a imagem padrão do portal (a mesma do
      // layout raiz, em public/ifizinha/og-portal.jpg) — assim o link nunca é
      // compartilhado sem imagem.
      images: [{ url: post.imagemUrl || '/ifizinha/og-portal.jpg', alt: post.titulo }],
    },
  };
}

export default async function PostPage({ params }: { params: Params }) {
  const post = await getPost(params.slug, params.postSlug);
  if (!post) notFound();

  const anexos = anexosDoJson(post.anexos);
  const documento = post.documentoHtml?.html ?? null;
  // Documentos costumam ser diagramados para ~1000px; o texto do editor, não.
  const largura = documento ? 'max-w-5xl' : 'max-w-3xl';

  const youtubeId = post.videoUrl?.includes('youtube.com/watch?v=')
    ? new URLSearchParams(new URL(post.videoUrl).search).get('v')
    : post.videoUrl?.includes('youtu.be/')
      ? post.videoUrl.split('youtu.be/')[1]?.split(/[?&]/)[0]
      : null;
  const temExtras = !!(youtubeId || post.arquivoPdfUrl || post.linkExterno || post.videoUrl || anexos.length > 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="pt-24 pb-10" style={{ background: `linear-gradient(135deg, ${post.projeto.corPrimaria} 0%, ${post.projeto.corPrimaria}cc 100%)` }}>
        <div className={`container mx-auto px-4 ${largura}`}>
          <div className="flex items-center gap-2 text-white/70 text-sm mb-4 flex-wrap">
            <Link href="/" className="hover:text-white transition-colors">Início</Link>
            <ChevronRight className="w-4 h-4" />
            <Link href="/projetos" className="hover:text-white transition-colors">Projetos</Link>
            <ChevronRight className="w-4 h-4" />
            <Link href={`/projetos/${post.projeto.slug}`} className="hover:text-white transition-colors">{post.projeto.nome}</Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-white truncate max-w-48">{post.titulo}</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-white mb-3 leading-tight">{post.titulo}</h1>
          <div className="flex items-center gap-4 text-white/80 text-sm flex-wrap">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {new Date(post.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
            </span>
            {post.author?.name && <span>Por {post.author.name}</span>}
          </div>
        </div>
      </div>

      <div className={`container mx-auto px-4 ${largura} py-8`}>
        <Link
          href={`/projetos/${post.projeto.slug}`}
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para {post.projeto.nome}
        </Link>

        {/* Post feito de arquivo HTML: o documento ocupa o quadro inteiro, com o
            visual dele (capa e texto do editor não entram — o documento já tem
            os seus). */}
        {documento && (
          <div className={`bg-white rounded-2xl border border-gray-100 overflow-hidden ${temExtras ? 'mb-6' : ''}`}>
            <DocumentoHtmlDoPost html={documento} titulo={post.titulo} />
          </div>
        )}

        {(!documento || temExtras) && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-6">
          {/* No post, a faixa de capa só aparece quando há uma escolha explícita
              (imagem ou ícone). Sem isso, o topo da publicação ganharia uma
              faixa cinza grande sem significado. */}
          {!documento && !semCapaEscolhida(post) && <PostCapa post={post} tamanho="hero" />}

          {!documento && (
            <SafeHtml
              html={post.conteudo}
              className="prose prose-sm sm:prose-base max-w-none prose-p:text-gray-700 prose-headings:text-gray-900 prose-a:text-azul-eletrico"
            />
          )}

          {youtubeId && (
            <div className="aspect-video bg-gray-100 rounded-xl overflow-hidden border border-gray-200">
              <iframe
                width="100%"
                height="100%"
                src={`https://www.youtube.com/embed/${youtubeId}`}
                title={post.titulo}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}

          {(post.arquivoPdfUrl || post.linkExterno || post.videoUrl || anexos.length > 0) && (
            <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100">
              {post.arquivoPdfUrl && (
                <a
                  href={post.arquivoPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 font-semibold px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-all text-sm"
                >
                  <FileText className="w-4 h-4" />
                  Baixar PDF
                </a>
              )}
              {post.linkExterno && (
                <a
                  href={post.linkExterno}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 font-semibold px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-all text-sm"
                >
                  <ExternalLink className="w-4 h-4" />
                  Link relacionado
                </a>
              )}
              {post.videoUrl && !youtubeId && (
                <a
                  href={post.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 font-semibold px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-all text-sm"
                >
                  <Video className="w-4 h-4" />
                  Assistir vídeo
                </a>
              )}
            </div>
          )}

          {/* Arquivos anexados pelo professor: ficam no storage do próprio
              servidor e o nginx serve como download. */}
          {anexos.length > 0 && (
            <div className="pt-2 border-t border-gray-100">
              <h2 className="text-sm font-bold text-gray-900 mb-2">Arquivos para download</h2>
              <ul className="space-y-2">
                {anexos.map((anexo) => (
                  <li key={anexo.path}>
                    <a
                      href={anexo.url}
                      download
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      <span className="w-9 h-9 rounded-lg bg-azul-eletrico/10 text-azul-eletrico flex items-center justify-center flex-shrink-0">
                        {ehPacote(anexo.nome ?? anexo.path)
                          ? <FileArchive className="w-4 h-4" />
                          : <FileText className="w-4 h-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-gray-900 truncate">
                          {anexo.nome ?? 'Arquivo'}
                        </span>
                        {anexo.bytes > 0 && (
                          <span className="block text-xs text-gray-400">{formatarMb(anexo.bytes)}</span>
                        )}
                      </span>
                      <Download className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
