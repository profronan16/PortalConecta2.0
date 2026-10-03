'use client';

import React, { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search, Filter, Users, ArrowRight, Sparkles, FolderOpen,
  ChevronLeft, ChevronRight, X, Loader2,
} from 'lucide-react';
import { getStatusLabel } from '@/lib/utils';
import {
  buildProjetosHref,
  paginasVisiveis,
  type ProjetoCard,
  type ProjetoFiltroParams,
} from '@/lib/projetos-filtros';

// Versão leve, sem dependência, do `stripHtml` de '@/lib/rich-text' — aquele
// usa `sanitize-html`, uma lib pensada pra rodar no servidor, que se
// importada aqui (componente client) infla bastante o bundle enviado ao
// navegador. Como o resultado só vira texto puro dentro de um <p> (nunca
// dangerouslySetInnerHTML), um strip por regex é seguro o bastante — o React
// escapa o texto normalmente na renderização.
function stripHtmlLite(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

type Props = {
  projetos: ProjetoCard[];
  destaques: ProjetoCard[];
  total: number;
  page: number;
  totalPages: number;
  filtros: { areas: string[]; statuses: string[] };
  filtrando: boolean;
  params: Required<Pick<ProjetoFiltroParams, 'q' | 'area' | 'status' | 'page'>>;
};

const DEBOUNCE_BUSCA_MS = 400;

/**
 * Listagem pública de projetos — filtro e paginação no SERVIDOR (ROADMAP 1.15b).
 *
 * O componente é controlado pela URL: mudar filtro/busca/página navega para
 * `/projetos?...`, o servidor refaz a consulta e devolve só a página atual.
 * Vantagens: escala (não envia todos os projetos ao navegador), URL
 * compartilhável/recarregável e "Total" consistente com o resto do site.
 */
export function ProjetosExplorer({
  projetos,
  destaques,
  total,
  page,
  totalPages,
  filtros,
  filtrando,
  params,
}: Props) {
  const router = useRouter();
  const [busca, setBusca] = useState(params.q);
  const [isPending, startTransition] = useTransition();
  const primeiroRender = useRef(true);

  // Mantém o input em sincronia quando a URL muda por fora (voltar/avançar).
  useEffect(() => {
    setBusca(params.q);
  }, [params.q]);

  // Busca digitada: espera o usuário parar de digitar antes de ir ao servidor.
  useEffect(() => {
    if (primeiroRender.current) {
      primeiroRender.current = false;
      return;
    }

    const destino = buildProjetosHref({ ...params, q: busca }, 1);
    const atual = buildProjetosHref(params, params.page);
    if (destino === atual) return;

    const timer = setTimeout(() => {
      startTransition(() => router.replace(destino, { scroll: false }));
    }, DEBOUNCE_BUSCA_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  const aplicarFiltro = (patch: Partial<ProjetoFiltroParams>) => {
    const destino = buildProjetosHref({ ...params, ...patch }, 1);
    startTransition(() => router.push(destino, { scroll: false }));
  };

  const limparFiltros = () => {
    setBusca('');
    startTransition(() => router.push('/projetos', { scroll: false }));
  };

  return (
    <>
      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            placeholder="Buscar por nome ou coordenador..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico focus:border-transparent"
          />
          {isPending && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
          )}
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={params.area}
              onChange={(e) => aplicarFiltro({ area: e.target.value })}
              className="pl-3 pr-8 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico bg-white"
            >
              <option value="">Área: Todas</option>
              {filtros.areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <select
            value={params.status}
            onChange={(e) => aplicarFiltro({ status: e.target.value })}
            className="pl-3 pr-8 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico bg-white"
          >
            <option value="">Status: Todos</option>
            {filtros.statuses.map((s) => <option key={s} value={s}>{getStatusLabel(s)}</option>)}
          </select>
        </div>
      </div>

      {/* Projetos Destaque — só faz sentido sem filtro ativo (senão duplica
          resultados que já aparecem, às vezes fora do filtro, na seção "Todos") */}
      {!filtrando && destaques.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-5">
            <Sparkles className="w-5 h-5 text-dourado-ifizinha" />
            <h2 className="font-bold text-gray-900 text-lg">Projetos em Destaque</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {destaques.map((projeto) => (
              <Link key={projeto.id} href={`/projetos/${projeto.slug}`} className="group block">
                <div className="bg-white rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden h-full flex flex-col">
                  <div className="h-24 relative flex items-end p-4" style={{ background: `linear-gradient(135deg, ${projeto.corPrimaria} 0%, ${projeto.corPrimaria}cc 100%)` }}>
                    <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center text-white font-black text-2xl border border-white/30">
                      {projeto.nome.charAt(0)}
                    </div>
                    <div className="ml-auto">
                      <span className="text-white/80 text-xs bg-black/20 rounded-full px-2.5 py-1 font-medium">
                        {getStatusLabel(projeto.status)}
                      </span>
                    </div>
                  </div>
                  <div className="p-5 flex-1 flex flex-col">
                    <h3 className="font-bold text-gray-900 text-base leading-snug mb-1 group-hover:text-azul-eletrico transition-colors">
                      {projeto.nome}
                    </h3>
                    <p className="text-sm text-gray-500 mb-2 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" />
                      {projeto.coordenador}
                    </p>
                    <p className="text-sm text-gray-500 leading-relaxed flex-1 line-clamp-2">{stripHtmlLite(projeto.descricao)}</p>
                    <div className="mt-4 flex items-center justify-between">
                      <span
                        className="inline-flex px-3 py-1 rounded-full text-xs font-semibold text-white"
                        style={{ backgroundColor: projeto.corPrimaria }}
                      >
                        {projeto.area}
                      </span>
                      <div className="flex items-center gap-1 text-xs font-semibold text-azul-eletrico group-hover:gap-2 transition-all">
                        Saiba mais
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Todos os projetos / resultados da busca */}
      <div className={isPending ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-gray-900 text-lg">
            {filtrando ? `Resultados (${total})` : `Todos os Projetos (${total})`}
          </h2>
          {filtrando && (
            <button
              onClick={limparFiltros}
              className="inline-flex items-center gap-1 text-sm text-azul-eletrico hover:underline"
            >
              <X className="w-3.5 h-3.5" />
              Limpar filtros
            </button>
          )}
        </div>

        {projetos.length === 0 ? (
          <div className="text-center py-16 text-gray-500 bg-white rounded-2xl border border-gray-100">
            <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Nenhum projeto encontrado com esses filtros</p>
            <button onClick={limparFiltros} className="mt-3 text-sm text-azul-eletrico hover:underline">
              Limpar filtros
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {projetos.map((projeto) => (
              <Link key={projeto.id} href={`/projetos/${projeto.slug}`} className="group block">
                <div className="bg-white rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
                  <div className="h-2 w-full" style={{ backgroundColor: projeto.corPrimaria }} />
                  <div className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-base flex-shrink-0 shadow-sm"
                        style={{ backgroundColor: projeto.corPrimaria }}
                      >
                        {projeto.nome.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 text-sm leading-snug group-hover:text-azul-eletrico transition-colors line-clamp-2">
                          {projeto.nome}
                        </h3>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{projeto.coordenador}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span
                        className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: projeto.corPrimaria }}
                      >
                        {projeto.area}
                      </span>
                      <span className={`text-xs font-medium flex items-center gap-1 ${
                        projeto.status === 'EM_EXECUCAO' ? 'text-green-600' :
                        projeto.status === 'ATIVO' ? 'text-blue-600' :
                        'text-gray-500'
                      }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          projeto.status === 'EM_EXECUCAO' ? 'bg-green-500 animate-pulse' :
                          projeto.status === 'ATIVO' ? 'bg-blue-500' :
                          'bg-gray-400'
                        }`} />
                        {getStatusLabel(projeto.status)}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Paginação server-side */}
        {totalPages > 1 && (
          <nav className="mt-8 flex items-center justify-center gap-1.5" aria-label="Paginação de projetos">
            <Link
              href={buildProjetosHref(params, Math.max(1, page - 1))}
              aria-disabled={page <= 1}
              tabIndex={page <= 1 ? -1 : undefined}
              className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${
                page <= 1
                  ? 'border-gray-100 text-gray-300 pointer-events-none'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              Anterior
            </Link>

            {paginasVisiveis(page, totalPages).map((p, idx) =>
              p === -1 ? (
                <span key={`gap-${idx}`} className="px-2 text-gray-400">…</span>
              ) : (
                <Link
                  key={p}
                  href={buildProjetosHref(params, p)}
                  aria-current={p === page ? 'page' : undefined}
                  className={`min-w-[2.5rem] text-center px-3 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                    p === page
                      ? 'bg-hero-gradient text-white border-transparent'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {p}
                </Link>
              ),
            )}

            <Link
              href={buildProjetosHref(params, Math.min(totalPages, page + 1))}
              aria-disabled={page >= totalPages}
              tabIndex={page >= totalPages ? -1 : undefined}
              className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${
                page >= totalPages
                  ? 'border-gray-100 text-gray-300 pointer-events-none'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Próxima
              <ChevronRight className="w-4 h-4" />
            </Link>
          </nav>
        )}

        {totalPages > 1 && (
          <p className="mt-4 text-center text-xs text-gray-400">
            Página {page} de {totalPages} · {total} projetos publicados
          </p>
        )}
      </div>
    </>
  );
}
