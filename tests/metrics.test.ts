import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Testes do item 1.17 / SPEC §5.1 — fonte única das métricas públicas.
 *
 * O critério de aceite é: "As métricas da home batem exatamente com as do
 * dashboard admin (mesma view)". Aqui garantimos que:
 *   1. existe UMA implementação (getPublicMetrics) e os dois consumidores a usam;
 *   2. a view materializada é a fonte primária e seus bigints viram number;
 *   3. sem a view, o fallback ao vivo usa os MESMOS filtros canônicos;
 *   4. a view é re-materializada quando fica velha (> 5 min);
 *   5. o cache em memória evita consultas repetidas.
 */

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  edital: { count: vi.fn() },
  projeto: { count: vi.fn() },
  user: { count: vi.fn() },
  evento: { count: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
  db: prismaMock,
}));

import {
  getPublicMetrics,
  computePublicMetricsLive,
  METRIC_FILTERS,
  VIEW_STALE_MS,
} from '@/lib/metrics';
import { cache } from '@/lib/cache';

function viewRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    editais_ativos: 3n,
    projetos_em_execucao: 7n,
    usuarios: 42n,
    eventos_proximos: 5n,
    refreshed_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  cache.clear();
  vi.clearAllMocks();
  // O fallback loga um aviso esperado; silencia para o output dos testes ficar limpo.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.$queryRaw.mockResolvedValue([viewRow()]);
});

describe('getPublicMetrics — view materializada como fonte primária', () => {
  it('lê a view e converte bigint (não serializável) em number', async () => {
    const metrics = await getPublicMetrics();

    expect(metrics).toEqual({
      editaisAtivos: 3,
      projetos: 7,
      usuarios: 42,
      eventos: 5,
      refreshedAt: expect.any(Date),
      source: 'view',
    });
    // Numbers de verdade: Server Actions quebram com BigInt no payload.
    expect(typeof metrics.editaisAtivos).toBe('number');
    expect(prismaMock.edital.count).not.toHaveBeenCalled();
  });

  it('não re-materializa a view quando ela está fresca', async () => {
    await getPublicMetrics();
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });

  it('re-materializa a view quando passa de 5 minutos e relê o resultado', async () => {
    const velha = new Date(Date.now() - VIEW_STALE_MS - 1000);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([viewRow({ refreshed_at: velha, editais_ativos: 1n })])
      .mockResolvedValueOnce([viewRow({ editais_ativos: 9n })]);

    const metrics = await getPublicMetrics();

    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(metrics.editaisAtivos).toBe(9);
  });

  it('cacheia em memória: a segunda leitura não vai ao banco', async () => {
    await getPublicMetrics();
    await getPublicMetrics();

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('skipCache ignora o cache em memória', async () => {
    await getPublicMetrics();
    await getPublicMetrics({ skipCache: true });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe('getPublicMetrics — fallback sem a view', () => {
  beforeEach(() => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('relation "public_metrics" does not exist'));
    prismaMock.edital.count.mockResolvedValue(4);
    prismaMock.projeto.count.mockResolvedValue(6);
    prismaMock.user.count.mockResolvedValue(10);
    prismaMock.evento.count.mockResolvedValue(2);
  });

  it('cai para contagem ao vivo e sinaliza source=live', async () => {
    const metrics = await getPublicMetrics();

    expect(metrics).toMatchObject({
      editaisAtivos: 4,
      projetos: 6,
      usuarios: 10,
      eventos: 2,
      refreshedAt: null,
      source: 'live',
    });
  });

  it('usa exatamente os filtros canônicos (mesmos para home e admin)', async () => {
    await getPublicMetrics();

    expect(prismaMock.edital.count).toHaveBeenCalledWith({
      where: {
        status: METRIC_FILTERS.editaisAtivos.status,
        review_status: METRIC_FILTERS.editaisAtivos.review_status,
        deleted_at: METRIC_FILTERS.editaisAtivos.deleted_at,
      },
    });
    expect(prismaMock.projeto.count).toHaveBeenCalledWith({
      where: {
        status: METRIC_FILTERS.projetos.status,
        review_status: METRIC_FILTERS.projetos.review_status,
        deleted_at: METRIC_FILTERS.projetos.deleted_at,
      },
    });
  });
});

describe('filtros canônicos (SPEC §5.1)', () => {
  it('editais só contam quando PUBLICADO e não deletado', () => {
    expect(METRIC_FILTERS.editaisAtivos).toEqual({
      status: 'ABERTO',
      review_status: 'PUBLICADO',
      deleted_at: null,
    });
  });

  it('projetos contam ATIVO/EM_EXECUCAO/INSCRICOES_ABERTAS, publicados e não deletados', () => {
    expect(METRIC_FILTERS.projetos).toEqual({
      status: { in: ['ATIVO', 'EM_EXECUCAO', 'INSCRICOES_ABERTAS'] },
      review_status: 'PUBLICADO',
      deleted_at: null,
    });
  });
});

describe('computePublicMetricsLive', () => {
  it('normaliza valores não numéricos para 0 em vez de NaN', async () => {
    prismaMock.edital.count.mockResolvedValue(undefined);
    prismaMock.projeto.count.mockResolvedValue('8');
    prismaMock.user.count.mockResolvedValue(10n);
    prismaMock.evento.count.mockResolvedValue(null);

    const metrics = await computePublicMetricsLive();

    expect(metrics).toMatchObject({
      editaisAtivos: 0,
      projetos: 8,
      usuarios: 10,
      eventos: 0,
      source: 'live',
    });
  });
});
