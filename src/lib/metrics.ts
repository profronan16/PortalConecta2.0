import { prisma } from '@/lib/prisma';
import { cache } from '@/lib/cache';
import type { Prisma } from '@prisma/client';

/**
 * Métricas públicas do portal (SPEC §5.1, ROADMAP 1.17).
 *
 * Regra de ouro: a home e o dashboard admin DEVEM mostrar os mesmos números.
 * Para isso existe uma única implementação (este arquivo) e, em produção, uma
 * única fonte física: a view materializada `public_metrics`
 * (ver prisma/public-metrics-setup.sql).
 *
 * Se a view não existir no banco (ambiente novo, sem rodar o SQL), a função cai
 * automaticamente para contagem ao vivo — com os MESMOS filtros — de modo que os
 * números continuam consistentes entre home e admin.
 */

export type PublicMetrics = {
  editaisAtivos: number;
  projetos: number;
  usuarios: number;
  eventos: number;
  /** Quando a fonte foi materializada; `null` quando veio de contagem ao vivo. */
  refreshedAt: Date | null;
  source: 'view' | 'live';
};

type MetricsRow = {
  editais_ativos: bigint | number | string;
  projetos_em_execucao: bigint | number | string;
  usuarios: bigint | number | string;
  eventos_proximos: bigint | number | string;
  refreshed_at: Date | string;
};

const CACHE_KEY = 'metrics:public';
/** Cache em memória: evita bater no banco a cada request da home. */
const CACHE_TTL_MS = 60 * 1000;
/** A view é considerada velha depois disso e é re-materializada na leitura. */
export const VIEW_STALE_MS = 5 * 60 * 1000;

/**
 * Filtros canônicos das métricas — ÚNICA definição no projeto.
 * Qualquer mudança aqui vale para home, admin e testes de uma vez.
 */
export const METRIC_FILTERS: {
  editaisAtivos: Prisma.EditalWhereInput;
  projetos: Prisma.ProjetoWhereInput;
} = {
  /** Editais realmente abertos e publicados (rascunho/despublicado não conta). */
  editaisAtivos: {
    status: 'ABERTO',
    review_status: 'PUBLICADO',
    deleted_at: null,
  },
  /** Projetos em execução/ativos/publicados (soft delete fora). */
  projetos: {
    status: { in: ['ATIVO', 'EM_EXECUCAO', 'INSCRICOES_ABERTAS'] },
    review_status: 'PUBLICADO',
    deleted_at: null,
  },
};

/** Postgres devolve count() como bigint; Server Actions não serializam BigInt. */
function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Lê a view materializada `public_metrics`. Lança se a view não existir. */
export async function readPublicMetricsView(): Promise<PublicMetrics> {
  const rows = await prisma.$queryRaw<MetricsRow[]>`
    SELECT editais_ativos, projetos_em_execucao, usuarios, eventos_proximos, refreshed_at
    FROM public_metrics
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    throw new Error('public_metrics vazia — rode refresh_public_metrics()');
  }

  return {
    editaisAtivos: toNumber(row.editais_ativos),
    projetos: toNumber(row.projetos_em_execucao),
    usuarios: toNumber(row.usuarios),
    eventos: toNumber(row.eventos_proximos),
    refreshedAt: toDate(row.refreshed_at),
    source: 'view',
  };
}

/** Re-materializa a view. Silencioso por design: falha não deve derrubar a home. */
export async function refreshPublicMetrics(): Promise<boolean> {
  try {
    await prisma.$executeRaw`SELECT refresh_public_metrics()`;
    return true;
  } catch (error) {
    console.warn('[metrics] refresh da view public_metrics falhou:', error);
    return false;
  }
}

/**
 * Contagem ao vivo com os filtros canônicos. Usada como fallback quando a view
 * não existe (ou está inacessível) e como referência nos testes.
 */
export async function computePublicMetricsLive(): Promise<PublicMetrics> {
  const [editaisAtivos, projetos, usuarios, eventos] = await Promise.all([
    prisma.edital.count({ where: METRIC_FILTERS.editaisAtivos }),
    prisma.projeto.count({ where: METRIC_FILTERS.projetos }),
    prisma.user.count(),
    prisma.evento.count({ where: { data: { gte: new Date() } } }),
  ]);

  return {
    editaisAtivos: toNumber(editaisAtivos),
    projetos: toNumber(projetos),
    usuarios: toNumber(usuarios),
    eventos: toNumber(eventos),
    refreshedAt: null,
    source: 'live',
  };
}

function isStale(refreshedAt: Date | null): boolean {
  if (!refreshedAt) return true;
  return Date.now() - refreshedAt.getTime() > VIEW_STALE_MS;
}

/**
 * Ponto de entrada único das métricas públicas.
 * Ordem: cache em memória → view materializada (refresh se velha) → contagem ao vivo.
 */
export async function getPublicMetrics(options?: { skipCache?: boolean }): Promise<PublicMetrics> {
  if (!options?.skipCache) {
    const cached = cache.get<PublicMetrics>(CACHE_KEY);
    if (cached) return cached;
  }

  let metrics: PublicMetrics;
  try {
    metrics = await readPublicMetricsView();

    if (isStale(metrics.refreshedAt)) {
      const refreshed = await refreshPublicMetrics();
      if (refreshed) metrics = await readPublicMetricsView();
    }
  } catch (error) {
    console.warn(
      '[metrics] view public_metrics indisponível — usando contagem ao vivo. ' +
        'Rode prisma/public-metrics-setup.sql para habilitar a view.',
      error,
    );
    metrics = await computePublicMetricsLive();
    // Não cacheia por muito tempo em modo degradado.
    cache.set(CACHE_KEY, metrics, 15 * 1000);
    return metrics;
  }

  cache.set(CACHE_KEY, metrics, CACHE_TTL_MS);
  return metrics;
}

/** Invalida o cache em memória (usar após escritas que afetam as métricas). */
export function invalidatePublicMetricsCache(): void {
  cache.invalidate('metrics:');
}
