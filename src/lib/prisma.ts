import { PrismaClient } from '@prisma/client';
import { cache } from '@/lib/cache';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

/**
 * Invalidação do cache de métricas públicas (SPEC §5.1, ROADMAP 1.17).
 *
 * As métricas da home/admin são cacheadas em memória por 60s
 * (src/lib/metrics.ts). Em vez de lembrar de chamar `invalidatePublicMetricsCache()`
 * em cada server action que escreve (eram ~10 pontos, e o SUAP sync escreve em
 * laço), invalidamos aqui — um único lugar, aplicado a qualquer escrita.
 *
 * Observação: middlewares do Prisma NÃO interceptam `$queryRaw`/`$executeRaw`,
 * então o refresh da view materializada não reentra aqui.
 */
const METRIC_MODELS = new Set(['Edital', 'Projeto', 'Evento', 'User']);
const WRITE_ACTIONS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

prisma.$use(async (params, next) => {
  const result = await next(params);

  if (params.model && METRIC_MODELS.has(params.model) && WRITE_ACTIONS.has(params.action)) {
    cache.invalidate('metrics:');
  }

  return result;
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export const db = prisma;
