import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ChevronRight, Users, Mail, Instagram, Globe, ArrowLeft,
  BookOpen, Calendar, ArrowRight, Image as ImageIcon, HelpCircle,
} from 'lucide-react';
import { getStatusLabel, getStatusColor } from '@/lib/utils';
import { stripHtml } from '@/lib/rich-text';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { prisma } from '@/lib/prisma';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const projeto = await prisma.projeto.findUnique({ where: { slug: params.slug } });
  if (!projeto) return { title: 'Projeto não encontrado' };
  return { title: projeto.nome, description: stripHtml(projeto.descricao).slice(0, 160) };
}

export default async function ProjetoPage({ params }: { params: Params }) {
  const projeto = await prisma.projeto.findUnique({
    where: { slug: params.slug },
    include: {
      posts: {
        where: { status: 'PUBLICADO' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
      faq: { orderBy: { ordem: 'asc' } },
      tags: true,
      cursos: true,
      coordenadores: {
        include: { user: { select: { name: true, email: true } } },
      },
    },
  });

  if (!projeto) notFound();

  // Buscar projetos relacionados (mesma área)
  const relacionados = await prisma.projeto.findMany({
    where: {
      id: { not: projeto.id },
      area: projeto.area,
      review_status: 'PUBLICADO',
      deleted_at: null,
    },
    take: 3,
    select: {
      id: true,
      nome: true,
      slug: true,
      area: true,
      corPrimaria: true,
      coordenador: true,
      resumoCurto: true,
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="pt-20 pb-10" style={{ background: `linear-gradient(135deg, ${projeto.corPrimaria} 0%, ${projeto.corPrimaria}cc 100%)` }}>
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center gap-2 text-white/70 text-sm mb-6">
            <Link href="/" className="hover:text-white transition-colors">Início</Link>
            <ChevronRight className="w-4 h-4" />
            <Link href="/projetos" className="hover:text-white transition-colors">Projetos</Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-white truncate max-w-48">{projeto.nome}</span>
          </div>

          <div className="flex items-start gap-5">
            <div className="w-16 h-16 md:w-20 md:h-20 bg-white/20 rounded-2xl flex items-center justify-center text-white font-black text-3xl border border-white/30 flex-shrink-0 overflow-hidden">
              {projeto.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={projeto.logoUrl} alt={`Logo ${projeto.nome}`} className="w-full h-full object-cover" />
              ) : (
                projeto.nome.charAt(0)
              )}
            </div>
            <div>
              <div className="flex flex-wrap gap-2 mb-3">
                <span className={`inline-flex px-3 py-1 rounded-full text-sm font-semibold border ${getStatusColor(projeto.status)}`}>
                  {getStatusLabel(projeto.status)}
                </span>
                <span className="bg-white/20 text-white text-sm font-medium px-3 py-1 rounded-full">
                  {projeto.area}
                </span>
                {projeto.status === 'INSCRICOES_ABERTAS' && (
                  <span className="bg-green-500 text-white text-sm font-medium px-3 py-1 rounded-full">
                    Inscrições Abertas
                  </span>
                )}
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-white mb-2 leading-tight">{projeto.nome}</h1>
              <div className="flex items-center gap-2 text-white/80 text-sm">
                <Users className="w-4 h-4" />
                <span>Coordenação: <strong className="text-white">{projeto.coordenador}</strong></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="container mx-auto px-4 max-w-5xl py-8">
        <Link href="/projetos" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" />
          Voltar aos projetos
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Sobre */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 className="font-bold text-gray-900 text-lg mb-4">Sobre o Projeto</h2>
              {projeto.descricao ? (
                <SafeHtml
                  html={projeto.descricao}
                  className="prose prose-sm sm:prose-base max-w-none prose-p:text-gray-700 prose-headings:text-gray-900"
                />
              ) : (
                <p className="text-gray-500 italic">Nenhuma descrição informada para este projeto.</p>
              )}
            </div>

            {/* Tags */}
            {projeto.tags.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <h2 className="font-bold text-gray-900 text-lg mb-3">Tags</h2>
                <div className="flex flex-wrap gap-2">
                  {projeto.tags.map((tag) => (
                    <span
                      key={tag.tag}
                      className="inline-flex px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
                    >
                      {tag.tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Cursos relacionados */}
            {projeto.cursos.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <h2 className="font-bold text-gray-900 text-lg mb-3">Cursos Relacionados</h2>
                <div className="flex flex-wrap gap-2">
                  {projeto.cursos.map((curso) => (
                    <span
                      key={curso.curso}
                      className="inline-flex px-3 py-1 rounded-full text-xs font-medium bg-azul-eletrico/10 text-azul-eletrico"
                    >
                      {curso.curso}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* FAQ */}
            {projeto.faq.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-6">
                <h2 className="font-bold text-gray-900 text-lg mb-4 flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-azul-eletrico" />
                  Perguntas Frequentes
                </h2>
                <div className="space-y-4">
                  {projeto.faq.map((faq) => (
                    <div key={faq.id} className="border-b border-gray-50 pb-4 last:border-0 last:pb-0">
                      <p className="font-semibold text-gray-900 text-sm mb-1">{faq.pergunta}</p>
                      <p className="text-gray-600 text-sm leading-relaxed">{faq.resposta}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Posts */}
            {projeto.posts.length > 0 && (
              <div>
                <h2 className="font-bold text-gray-900 text-2xl mb-6">Últimas Atualizações</h2>
                <div className="space-y-4">
                  {projeto.posts.map((post) => (
                    <Link
                      key={post.id}
                      href={`/projetos/${projeto.slug}/posts/${post.slug}`}
                      className="group bg-white rounded-2xl border border-gray-100 p-5 hover:border-gray-200 hover:shadow-md transition-all flex flex-col sm:flex-row gap-5"
                    >
                      {post.imagemUrl ? (
                        <div className="w-full sm:w-48 h-32 flex-shrink-0 rounded-xl overflow-hidden bg-gray-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={post.imagemUrl} alt={post.titulo} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-full sm:w-48 h-32 flex-shrink-0 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center">
                          <ImageIcon className="w-8 h-8 text-gray-300" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="text-xs text-gray-400 font-medium mb-1 flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(post.createdAt).toLocaleDateString('pt-BR')}
                        </div>
                        <h3 className="font-bold text-gray-900 text-lg mb-2 leading-tight group-hover:text-azul-eletrico transition-colors">{post.titulo}</h3>
                        {post.resumo && <p className="text-sm text-gray-500 line-clamp-2 mb-3">{post.resumo}</p>}
                        <span className="text-xs font-semibold text-azul-eletrico inline-flex items-center gap-1">
                          Ler mais <ArrowRight className="w-3 h-3" />
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Projetos relacionados */}
            {relacionados.length > 0 && (
              <div>
                <h2 className="font-bold text-gray-900 text-2xl mb-6">Projetos Relacionados</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {relacionados.map((r) => (
                    <Link key={r.id} href={`/projetos/${r.slug}`} className="group block">
                      <div className="bg-white rounded-xl border border-gray-100 p-4 hover:border-gray-200 hover:shadow-md transition-all">
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm mb-3"
                          style={{ backgroundColor: r.corPrimaria }}
                        >
                          {r.nome.charAt(0)}
                        </div>
                        <h3 className="font-semibold text-gray-900 text-sm group-hover:text-azul-eletrico transition-colors line-clamp-2">
                          {r.nome}
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">{r.coordenador}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Info card */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h3 className="font-bold text-gray-900 mb-4">Informações</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${projeto.corPrimaria}20` }}>
                    <Users className="w-4 h-4" style={{ color: projeto.corPrimaria }} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium">Coordenação</p>
                    <p className="text-sm text-gray-700 font-semibold">{projeto.coordenador}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${projeto.corPrimaria}20` }}>
                    <BookOpen className="w-4 h-4" style={{ color: projeto.corPrimaria }} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium">Área</p>
                    <p className="text-sm text-gray-700 font-semibold">{projeto.area}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${projeto.corPrimaria}20` }}>
                    <Calendar className="w-4 h-4" style={{ color: projeto.corPrimaria }} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium">Status</p>
                    <p className="text-sm font-semibold text-green-600">{getStatusLabel(projeto.status)}</p>
                  </div>
                </div>

                {/* Vagas */}
                {(projeto.vagasBolsista > 0 || projeto.vagasVoluntario > 0) && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${projeto.corPrimaria}20` }}>
                      <Users className="w-4 h-4" style={{ color: projeto.corPrimaria }} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 font-medium">Vagas</p>
                      <p className="text-sm text-gray-700 font-semibold">
                        {projeto.vagasBolsista > 0 && `${projeto.vagasBolsista} bolsista${projeto.vagasBolsista > 1 ? 's' : ''}`}
                        {projeto.vagasBolsista > 0 && projeto.vagasVoluntario > 0 && ' / '}
                        {projeto.vagasVoluntario > 0 && `${projeto.vagasVoluntario} voluntário${projeto.vagasVoluntario > 1 ? 's' : ''}`}
                      </p>
                    </div>
                  </div>
                )}

                {/* Coordenadores */}
                {projeto.coordenadores.length > 0 && (
                  <div className="pt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-400 font-medium mb-2">Coordenadores</p>
                    {projeto.coordenadores.map((c) => (
                      <p key={c.user_id} className="text-sm text-gray-700">{c.user.name || c.user.email}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* Contatos */}
              {(projeto.email || projeto.instagram || projeto.site) && (
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Contato</p>
                  {projeto.email && (
                    <a href={`mailto:${projeto.email}`} className="flex items-center gap-2 text-sm text-gray-600 hover:text-azul-eletrico transition-colors">
                      <Mail className="w-4 h-4" />
                      {projeto.email}
                    </a>
                  )}
                  {projeto.instagram && (
                    <a href={`https://instagram.com/${projeto.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-gray-600 hover:text-azul-eletrico transition-colors">
                      <Instagram className="w-4 h-4" />
                      {projeto.instagram}
                    </a>
                  )}
                  {projeto.site && (
                    <a href={projeto.site} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-gray-600 hover:text-azul-eletrico transition-colors">
                      <Globe className="w-4 h-4" />
                      Site do projeto
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* CTA */}
            <div className="rounded-2xl p-5 text-white" style={{ background: `linear-gradient(135deg, ${projeto.corPrimaria} 0%, ${projeto.corPrimaria}cc 100%)` }}>
              <h3 className="font-bold mb-2">Quer participar?</h3>
              {projeto.status === 'INSCRICOES_ABERTAS' ? (
                <>
                  <p className="text-sm text-white/80 mb-4">Inscrições abertas! Preencha o formulário agora.</p>
                  <Link
                    href={`/inscricao/${projeto.slug}`}
                    className="inline-flex items-center gap-1.5 bg-white text-gray-900 font-semibold px-4 py-2 rounded-xl hover:bg-white/90 transition-all text-sm w-full justify-center"
                  >
                    Inscreva-se agora
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-sm text-white/80 mb-4">Inscrições não estão abertas no momento.</p>
                  <Link href="/editais" className="inline-flex items-center gap-1.5 bg-white text-gray-900 font-semibold px-4 py-2 rounded-xl hover:bg-white/90 transition-all text-sm w-full justify-center">
                    Ver Editais de Bolsas
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
