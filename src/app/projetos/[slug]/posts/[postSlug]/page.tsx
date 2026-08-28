import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, Calendar, ArrowLeft, FileText, ExternalLink, Video } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { stripHtml } from '@/lib/rich-text';
import { SafeHtml } from '@/components/ui/SafeHtml';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

type Params = { slug: string; postSlug: string };

async function getPost(slug: string, postSlug: string) {
  return prisma.post.findFirst({
    where: { slug: postSlug, status: 'PUBLICADO', projeto: { slug } },
    include: {
      projeto: { select: { nome: true, slug: true, corPrimaria: true } },
      author: { select: { name: true } },
    },
  });
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const post = await getPost(params.slug, params.postSlug);
  if (!post) return { title: 'Post não encontrado' };
  return {
    title: post.titulo,
    description: (post.resumo || stripHtml(post.conteudo)).slice(0, 160),
  };
}

export default async function PostPage({ params }: { params: Params }) {
  const post = await getPost(params.slug, params.postSlug);
  if (!post) notFound();

  const youtubeId = post.videoUrl?.includes('youtube.com/watch?v=')
    ? new URLSearchParams(new URL(post.videoUrl).search).get('v')
    : post.videoUrl?.includes('youtu.be/')
      ? post.videoUrl.split('youtu.be/')[1]?.split(/[?&]/)[0]
      : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="pt-24 pb-10" style={{ background: `linear-gradient(135deg, ${post.projeto.corPrimaria} 0%, ${post.projeto.corPrimaria}cc 100%)` }}>
        <div className="container mx-auto px-4 max-w-3xl">
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

      <div className="container mx-auto px-4 max-w-3xl py-8">
        <Link
          href={`/projetos/${post.projeto.slug}`}
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para {post.projeto.nome}
        </Link>

        <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 space-y-6">
          {post.imagemUrl && (
            <div className="w-full aspect-video rounded-xl overflow-hidden bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={post.imagemUrl} alt={post.titulo} className="w-full h-full object-cover" />
            </div>
          )}

          <SafeHtml
            html={post.conteudo}
            className="prose prose-sm sm:prose-base max-w-none prose-p:text-gray-700 prose-headings:text-gray-900 prose-a:text-azul-eletrico"
          />

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

          {(post.arquivoPdfUrl || post.linkExterno) && (
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
        </div>
      </div>
    </div>
  );
}
