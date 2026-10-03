import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Teste de regressão do furo de visibilidade em `/editais/[slug]`.
 *
 * Antes: a página buscava o edital apenas pelo `slug`. Um edital em RASCUNHO
 * (não aprovado por humano) ou já apagado (soft delete) era renderizado para
 * qualquer visitante que tivesse a URL — e o `generateMetadata` vazava o título.
 *
 * O critério §14 diz: "Nenhum edital fica público sem aprovação humana".
 */

const prismaMock = vi.hoisted(() => ({
  edital: { findFirst: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, db: prismaMock }));

import {
  EDITAL_PUBLICO_WHERE,
  buscarEditalPublicoPorSlug,
  buscarResumoEditalPublico,
} from '@/lib/editais-publicos';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.edital.findFirst.mockResolvedValue(null);
});

describe('EDITAL_PUBLICO_WHERE', () => {
  it('exige PUBLICADO e não deletado', () => {
    expect(EDITAL_PUBLICO_WHERE).toEqual({
      review_status: 'PUBLICADO',
      deleted_at: null,
    });
  });
});

describe('buscarEditalPublicoPorSlug', () => {
  it('aplica o filtro de visibilidade na consulta (não confia só no slug)', async () => {
    await buscarEditalPublicoPorSlug('edital-x', { id: true });

    expect(prismaMock.edital.findFirst).toHaveBeenCalledWith({
      where: {
        slug: 'edital-x',
        review_status: 'PUBLICADO',
        deleted_at: null,
      },
      select: { id: true },
    });
  });

  it('devolve null para rascunho (a página então chama notFound)', async () => {
    prismaMock.edital.findFirst.mockResolvedValue(null);

    expect(await buscarEditalPublicoPorSlug('rascunho', { id: true })).toBeNull();
  });

  it('devolve o edital quando ele é público', async () => {
    prismaMock.edital.findFirst.mockResolvedValue({ id: 'e1', titulo: 'Edital' });

    await expect(buscarEditalPublicoPorSlug('edital', { id: true })).resolves.toEqual({
      id: 'e1',
      titulo: 'Edital',
    });
  });

  it('repassa exatamente os campos pedidos (sem trazer o edital inteiro)', async () => {
    await buscarResumoEditalPublico('edital');

    const argumento = prismaMock.edital.findFirst.mock.calls[0][0];
    expect(argumento.select).toEqual({ titulo: true, resumoSimples: true, resumo: true });
    expect(argumento.where.review_status).toBe('PUBLICADO');
  });
});
