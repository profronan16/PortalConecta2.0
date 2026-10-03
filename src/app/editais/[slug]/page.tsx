import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ChevronRight, Clock, ExternalLink, FileText, BookOpen,
  Calendar, Sparkles, AlertCircle, ArrowLeft,
} from 'lucide-react';
import { formatDate, getDaysUntil, getStatusLabel, getStatusColor, getCategoryColor } from '@/lib/utils';
import { prisma } from '@/lib/prisma';
import { BotaoFavorito } from '@/components/ui/BotaoFavorito';
import { buscarEditalPublicoPorSlug, buscarResumoEditalPublico } from '@/lib/editais-publicos';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

// O JSON salvo em `traducaoIFizinha` tem duas formas diferentes conforme a
// origem do edital: o sync do SUAP grava chaves em camelCase com
// `documentos` como array (src/lib/suap-sync.ts), enquanto o formulário do
// admin grava chaves em minúsculo com `documentos` como string única
// (src/actions/admin.ts EditalFormData). Sem normalizar as duas formas
// aqui, um edital criado pelo admin com `documentos` string quebrava esta
// página com "documentos.map is not a function" (string não tem `.map`).
interface TraducaoIFizinhaRaw {
  oQueE?: string;
  quemPode?: string;
  comoParticipar?: string;
  quando?: string;
  documentos?: string | string[];
  mensagemIfizinha?: string;
  oquee?: string;
  quempode?: string;
  comoinscrever?: string;
  prazo?: string;
  observacoes?: string;
}

interface TraducaoIFizinha {
  oQueE: string;
  quemPode: string;
  comoParticipar: string;
  quando: string;
  documentos: string[];
  mensagemIfizinha: string;
}

function normalizarTraducao(raw: unknown): TraducaoIFizinha {
  const t = (raw && typeof raw === 'object' ? raw : {}) as TraducaoIFizinhaRaw;
  return {
    oQueE: t.oQueE || t.oquee || '',
    quemPode: t.quemPode || t.quempode || '',
    comoParticipar: t.comoParticipar || t.comoinscrever || '',
    quando: t.quando || t.prazo || '',
    documentos: Array.isArray(t.documentos)
      ? t.documentos
      : t.documentos
        ? [t.documentos]
        : [],
    mensagemIfizinha: t.mensagemIfizinha || t.observacoes || '',
  };
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  // Respeita a visibilidade pública: rascunho não vaza nem no metadata.
  const edital = await buscarResumoEditalPublico(params.slug);
  if (!edital) return { title: 'Edital não encontrado' };
  return {
    title: edital.titulo,
    description: edital.resumoSimples || edital.resumo || undefined,
  };
}

export default async function EditalDetalhePage({ params }: { params: { slug: string } }) {
  // Só edital PUBLICADO e não deletado chega ao público (ver
  // src/lib/editais-publicos.ts — antes daqui um rascunho era acessível pela URL).
  const edital = await buscarEditalPublicoPorSlug(params.slug, {
      id: true,
      titulo: true,
      slug: true,
      categoria: true,
      resumoSimples: true,
      resumo: true,
      dataEncerramento: true,
      inscricao_inicio: true,
      dataResultadoParcial: true,
      prazoRecurso: true,
      dataResultadoFinal: true,
      status: true,
      traducaoIFizinha: true,
      linkOficial: true,
      arquivoPdfUrl: true,
      visualizacoes: true,
      quemPode: true,
      quemNaoPode: true,
      beneficios: true,
      criteriosSelecao: true,
      documentosNecessarios: true,
      contatoDuvidas: true,
      publicoAlvo: true,
      localInscricao: true,
      linkInscricao: true,
    });

  if (!edital) notFound();

  const traducao = normalizarTraducao(edital.traducaoIFizinha);
  const daysLeft = edital.dataEncerramento ? getDaysUntil(edital.dataEncerramento) : null;
  const isUrgent = daysLeft !== null && daysLeft <= 7 && daysLeft > 0;
  const isExpired = daysLeft !== null && daysLeft <= 0;
  const resumo = edital.resumoSimples || edital.resumo || '';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <div className="bg-hero-gradient pt-24 pb-12">
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="flex items-center gap-2 text-white/70 text-sm mb-4">
            <Link href="/" className="hover:text-white transition-colors">Início</Link>
            <ChevronRight className="w-4 h-4" />
            <Link href="/editais" className="hover:text-white transition-colors">Editais</Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-white line-clamp-1">{edital.titulo}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${getCategoryColor(edital.categoria)}`}>
              {getStatusLabel(edital.categoria)}
            </span>
            <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold border ${getStatusColor(edital.status)}`}>
              {getStatusLabel(edital.status)}
            </span>
            {isUrgent && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-orange-600 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-full animate-pulse">
                <AlertCircle className="w-3 h-3" />
                {daysLeft === 1 ? 'Último dia!' : `${daysLeft} dias restantes!`}
              </span>
            )}
          </div>

          <h1 className="text-2xl md:text-3xl font-black text-white mb-3">{edital.titulo}</h1>

          {resumo && (
            <p className="text-white/80 text-sm leading-relaxed max-w-3xl">{resumo}</p>
          )}

          <div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-white/70">
            {edital.dataEncerramento && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                Encerra: {formatDate(edital.dataEncerramento)}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <ExternalLink className="w-4 h-4" />
              {edital.visualizacoes} visualizações
            </div>
          </div>
        </div>
      </div>

      {/* Aviso */}
      <div className="bg-blue-50 border-b border-blue-100">
        <div className="container mx-auto px-4 max-w-4xl py-3">
          <div className="flex items-center gap-2 text-blue-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm font-medium">
              <strong>Aviso:</strong> Este é um resumo. O edital oficial em PDF prevalece em caso de divergência.
            </p>
          </div>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="container mx-auto px-4 max-w-4xl py-8 space-y-6">
        {/* Tabs: IFizinha / Oficial */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="p-6">
            <h2 className="font-bold text-gray-900 text-lg mb-4 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-dourado-ifizinha" />
              A IFizinha Explica
            </h2>

            {traducao.oQueE && (
              <div className="mb-5">
                <h3 className="font-semibold text-gray-800 text-sm mb-1">O que é?</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{traducao.oQueE}</p>
              </div>
            )}

            {traducao.quemPode && (
              <div className="mb-5">
                <h3 className="font-semibold text-gray-800 text-sm mb-1">Quem pode participar?</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{traducao.quemPode}</p>
              </div>
            )}

            {traducao.comoParticipar && (
              <div className="mb-5">
                <h3 className="font-semibold text-gray-800 text-sm mb-1">Como participar?</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{traducao.comoParticipar}</p>
              </div>
            )}

            {traducao.quando && (
              <div className="mb-5">
                <h3 className="font-semibold text-gray-800 text-sm mb-1">Prazos</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{traducao.quando}</p>
              </div>
            )}

            {traducao.documentos && traducao.documentos.length > 0 && (
              <div className="mb-5">
                <h3 className="font-semibold text-gray-800 text-sm mb-2">Documentos necessários</h3>
                <ul className="space-y-1.5">
                  {traducao.documentos.map((doc, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="text-azul-eletrico mt-0.5">•</span>
                      {doc}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {traducao.mensagemIfizinha && (
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4 border border-purple-100 mt-4">
                <p className="text-sm text-gray-700 leading-relaxed">{traducao.mensagemIfizinha}</p>
              </div>
            )}
          </div>
        </div>

        {/* Datas importantes */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h2 className="font-bold text-gray-900 text-lg mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-azul-eletrico" />
            Datas Importantes
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {edital.inscricao_inicio && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="w-2 h-2 bg-green-500 rounded-full" />
                <div>
                  <p className="text-xs text-gray-500">Início inscrições</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(edital.inscricao_inicio)}</p>
                </div>
              </div>
            )}
            {edital.dataEncerramento && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="w-2 h-2 bg-red-500 rounded-full" />
                <div>
                  <p className="text-xs text-gray-500">Fim inscrições</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(edital.dataEncerramento)}</p>
                </div>
              </div>
            )}
            {edital.dataResultadoParcial && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="w-2 h-2 bg-yellow-500 rounded-full" />
                <div>
                  <p className="text-xs text-gray-500">Resultado parcial</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(edital.dataResultadoParcial)}</p>
                </div>
              </div>
            )}
            {edital.prazoRecurso && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="w-2 h-2 bg-orange-500 rounded-full" />
                <div>
                  <p className="text-xs text-gray-500">Prazo recurso</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(edital.prazoRecurso)}</p>
                </div>
              </div>
            )}
            {edital.dataResultadoFinal && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                <div>
                  <p className="text-xs text-gray-500">Resultado final</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(edital.dataResultadoFinal)}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Links */}
        <div className="flex flex-wrap gap-3">
          {edital.arquivoPdfUrl && (
            <a
              href={edital.arquivoPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-azul-eletrico text-white font-semibold px-6 py-3 rounded-xl hover:bg-azul-eletrico/90 transition-all"
            >
              <FileText className="w-5 h-5" />
              Baixar Edital Oficial (PDF)
            </a>
          )}
          {edital.linkOficial && (
            <a
              href={edital.linkOficial}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl hover:bg-gray-50 transition-all"
            >
              <ExternalLink className="w-5 h-5" />
              Link Oficial
            </a>
          )}
          <BotaoFavorito entidade="edital" entidadeId={edital.id} />
          <Link
            href="/editais"
            className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl hover:bg-gray-50 transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
            Voltar
          </Link>
        </div>
      </div>
    </div>
  );
}
