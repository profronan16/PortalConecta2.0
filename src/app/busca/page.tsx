import React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  FolderOpen,
  Lightbulb,
  Newspaper,
  Search,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { buscarGlobal, type GrupoBusca } from '@/lib/busca';
import {
  BUSCA_HREF,
  BUSCA_MAX_TERMO,
  BUSCA_MIN_TERMO,
  TIPOS_BUSCA,
  TIPO_BUSCA_INFO,
  ancoraDoTipo,
  limitarResultados,
  normalizarParamsBusca,
  type BuscaSearchParams,
  type TipoBusca,
} from '@/lib/busca-filtros';
import { buildProjetosHref } from '@/lib/projetos-filtros';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Busca',
  description:
    'Busque em um só lugar os projetos, editais e publicações do IFPR Campus Ivaiporã.',
};

/**
 * Ícone e cor por categoria. As classes ficam em strings literais (nada de
 * montar `bg-${cor}`) porque o Tailwind só enxerga classes que aparecem
 * escritas no código.
 */
const ESTILO_POR_TIPO: Record<TipoBusca, { icone: LucideIcon; destaque: string }> = {
  projeto: { icone: FolderOpen, destaque: 'bg-azul-eletrico/10 text-azul-eletrico' },
  edital: { icone: BookOpen, destaque: 'bg-roxo-luminoso/10 text-roxo-luminoso' },
  post: { icone: Newspaper, destaque: 'bg-rosa-vibrante/10 text-rosa-vibrante' },
};

/** Atalhos mostrados quando ainda não há termo (ou quando nada foi achado). */
const ATALHOS = [
  { href: '/projetos', label: 'Ver todos os projetos' },
  { href: '/editais', label: 'Ver todos os editais' },
  { href: '/agenda', label: 'Ver a agenda' },
];

function BuscaForm({ termoInicial }: { termoInicial: string }) {
  // `<form method="get">` puro: a busca funciona sem JavaScript, e o Next lê
  // `?q=` nos searchParams do Server Component.
  return (
    <form method="get" action={BUSCA_HREF} role="search" className="mt-8 max-w-2xl">
      <label htmlFor="q" className="sr-only">
        Buscar no portal
      </label>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={termoInicial}
            maxLength={BUSCA_MAX_TERMO}
            autoComplete="off"
            placeholder="Ex.: extensão, bolsa, horta, edital 01/2025…"
            className="w-full pl-12 pr-4 py-3.5 rounded-xl bg-white text-gray-900 placeholder:text-gray-400 border border-white/40 shadow-sm focus:outline-none focus:ring-2 focus:ring-white/70"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 border border-white/40 text-white font-semibold px-6 py-3.5 rounded-xl transition-colors backdrop-blur-sm"
        >
          <Search className="w-4 h-4" />
          Buscar
        </button>
      </div>
      <p className="text-white/70 text-xs mt-2">
        Digite pelo menos {BUSCA_MIN_TERMO} caracteres. A busca cobre apenas o conteúdo
        publicado no portal.
      </p>
    </form>
  );
}

function CartaoResultado({ grupo, termo }: { grupo: GrupoBusca; termo: string }) {
  const info = TIPO_BUSCA_INFO[grupo.tipo];
  const estilo = ESTILO_POR_TIPO[grupo.tipo];
  const Icone = estilo.icone;
  const itens = limitarResultados(grupo.itens);
  const exibindoParcial = grupo.total > itens.length;

  return (
    <section id={ancoraDoTipo(grupo.tipo)} className="scroll-mt-28">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${estilo.destaque}`}>
            <Icone className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-black text-gray-900">{info.plural}</h2>
            <p className="text-xs text-gray-400">{info.descricao}</p>
          </div>
        </div>
        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${estilo.destaque}`}>
          {grupo.total} {grupo.total === 1 ? 'resultado' : 'resultados'}
        </span>
      </div>

      <div className="space-y-3">
        {itens.map((item) => (
          <Link
            key={`${item.tipo}-${item.id}`}
            href={item.href}
            className="group flex items-center gap-4 bg-white rounded-2xl border border-gray-100 p-5 hover:border-azul-eletrico/30 hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            <div className="flex-1 min-w-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {info.singular}
              </span>
              <h3 className="font-bold text-gray-900 leading-snug group-hover:text-azul-eletrico transition-colors">
                {item.titulo}
              </h3>
              {item.subtitulo && (
                <p className="text-sm text-gray-500 truncate mt-0.5">{item.subtitulo}</p>
              )}
            </div>
            <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0 group-hover:bg-azul-eletrico transition-colors">
              <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" />
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-400">
        {exibindoParcial && (
          <span>
            Mostrando os {itens.length} mais relevantes de {grupo.total}.
          </span>
        )}
        {/* Só projetos têm busca server-side própria hoje (`/projetos?q=`). */}
        {grupo.tipo === 'projeto' && (
          <Link
            href={buildProjetosHref({ q: termo })}
            className="inline-flex items-center gap-1 font-semibold text-azul-eletrico hover:underline"
          >
            Ver todos os projetos com “{termo}”
            <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>
    </section>
  );
}

export default async function BuscaPage({
  searchParams,
}: {
  searchParams: BuscaSearchParams;
}) {
  const params = normalizarParamsBusca(searchParams);
  // `buscarGlobal` também valida o termo: termo inválido nem chega ao banco.
  const resultado = await buscarGlobal(params.q);

  const buscando = resultado.valido;
  const termoCurto = params.q.length > 0 && !params.valido;
  const nadaEncontrado = buscando && resultado.total === 0;
  const gruposComItens = resultado.grupos.filter((grupo) => grupo.itens.length > 0);

  return (
    <div className="min-h-screen">
      {/* Hero + formulário */}
      <div className="bg-hero-gradient pt-24 pb-16">
        <div className="container mx-auto px-4 max-w-7xl">
          <div className="flex items-center gap-2 text-white/70 text-sm mb-4">
            <Link href="/" className="hover:text-white transition-colors">
              Início
            </Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-white">Busca</span>
          </div>
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 bg-white/15 rounded-2xl flex items-center justify-center border border-white/30 flex-shrink-0">
              <Search className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-black text-white mb-2">
                Busca no Portal Conecta
              </h1>
              <p className="text-white/80 text-lg max-w-2xl">
                Projetos, editais e publicações do IFPR Campus Ivaiporã em um só lugar.
              </p>
            </div>
          </div>

          <BuscaForm termoInicial={params.q} />
        </div>
      </div>

      <div className="container mx-auto px-4 max-w-5xl py-10">
        {/* Sem termo: orienta em vez de listar o portal inteiro */}
        {!buscando && !termoCurto && (
          <div className="space-y-8">
            <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8 text-center">
              <div className="w-14 h-14 bg-card-gradient rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Search className="w-7 h-7 text-azul-eletrico" />
              </div>
              <h2 className="text-2xl font-black text-gray-900 mb-2">
                O que você procura?
              </h2>
              <p className="text-gray-500 max-w-lg mx-auto">
                Digite uma palavra-chave no campo acima. Você pode buscar pelo nome de um
                projeto, pela coordenação, pelo número de um edital ou por um assunto
                publicado nos projetos.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {TIPOS_BUSCA.map((tipo) => {
                const info = TIPO_BUSCA_INFO[tipo];
                const estilo = ESTILO_POR_TIPO[tipo];
                const Icone = estilo.icone;
                return (
                  <div
                    key={tipo}
                    className="bg-white rounded-2xl border border-gray-100 p-5"
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${estilo.destaque}`}
                    >
                      <Icone className="w-5 h-5" />
                    </div>
                    <h3 className="font-bold text-gray-900 mb-1">{info.plural}</h3>
                    <p className="text-sm text-gray-500">Busca por {info.descricao}.</p>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-3">
              {ATALHOS.map((atalho) => (
                <Link
                  key={atalho.href}
                  href={atalho.href}
                  className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 font-semibold px-5 py-3 rounded-xl hover:bg-gray-50 transition-colors text-sm"
                >
                  {atalho.label}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Termo curto demais */}
        {termoCurto && (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
            <div className="w-14 h-14 bg-yellow-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Lightbulb className="w-7 h-7 text-dourado-ifizinha" />
            </div>
            <h2 className="text-xl font-black text-gray-900 mb-2">
              Escreva um pouco mais
            </h2>
            <p className="text-gray-500 max-w-md mx-auto">
              Sua busca por <strong className="text-gray-700">“{params.q}”</strong> é curta
              demais — precisamos de pelo menos {BUSCA_MIN_TERMO} caracteres para encontrar
              algo útil.
            </p>
          </div>
        )}

        {/* Busca feita, nada encontrado */}
        {nadaEncontrado && (
          <div className="space-y-8">
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
              <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Search className="w-7 h-7 text-gray-400" />
              </div>
              <h2 className="text-xl font-black text-gray-900 mb-2">
                Nenhum resultado para “{resultado.termo}”
              </h2>
              <p className="text-gray-500 max-w-lg mx-auto">
                Não encontramos projetos, editais ou publicações com esse termo. Tente
                outra grafia, use menos palavras ou procure um termo mais geral. Lembre-se
                de que a busca diferencia acentos: “extensão” e “extensao” são termos
                diferentes.
              </p>
            </div>

            <div className="flex flex-wrap gap-3 justify-center">
              {ATALHOS.map((atalho) => (
                <Link
                  key={atalho.href}
                  href={atalho.href}
                  className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 font-semibold px-5 py-3 rounded-xl hover:bg-gray-50 transition-colors text-sm"
                >
                  {atalho.label}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Resultados agrupados por tipo */}
        {buscando && gruposComItens.length > 0 && (
          <div className="space-y-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-500">
                <strong className="text-gray-900">{resultado.total}</strong>{' '}
                {resultado.total === 1 ? 'resultado' : 'resultados'} para{' '}
                <strong className="text-gray-900">“{resultado.termo}”</strong>
              </p>
              <Link
                href={BUSCA_HREF}
                className="text-sm font-semibold text-azul-eletrico hover:underline"
              >
                Limpar busca
              </Link>
            </div>

            {gruposComItens.map((grupo) => (
              <CartaoResultado key={grupo.tipo} grupo={grupo} termo={resultado.termo} />
            ))}

            {/* Dica da IFizinha — mesmo tom das outras páginas públicas */}
            <div className="bg-gradient-to-br from-azul-eletrico/5 via-roxo-luminoso/5 to-rosa-vibrante/5 rounded-3xl border border-gray-100 p-6 flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-dourado-ifizinha flex-shrink-0 mt-0.5" />
              <p className="text-sm text-gray-600">
                Não achou o que queria? A IFizinha, nossa assistente, responde perguntas
                sobre editais e projetos em linguagem simples — inclusive sobre prazos e
                documentos.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
