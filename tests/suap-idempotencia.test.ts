import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Critério §14 do bloco SUAP: "Sync é idempotente (rodar 2x não duplica)".
 *
 * Dois níveis de cobertura:
 *  1. a CHAVE de identidade (`suapIdUnico`) — se ela colidir entre pesquisa e
 *     extensão, um projeto sobrescreve o outro;
 *  2. o COMPORTAMENTO do sync — a segunda execução encontra o registro por
 *     `suapId` e atualiza, em vez de criar de novo.
 */

const prismaMock = vi.hoisted(() => ({
  projeto: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  syncLog: { create: vi.fn() },
}));

const suapApiMock = vi.hoisted(() => ({
  fetchProjetosFromSuap: vi.fn(),
  fetchEditaisFromSuap: vi.fn(),
  mapStatusProjeto: vi.fn(),
  mapCategoriaEdital: vi.fn(),
}));

const sinteticoMock = vi.hoisted(() => ({
  sincronizarProjetoSintetico: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, db: prismaMock }));
vi.mock('@/lib/suap-api', () => suapApiMock);
vi.mock('@/lib/projeto-sintetico', () => sinteticoMock);

import { suapIdUnico, idsColidem } from '@/lib/suap-identidade';
import { syncProjetos } from '@/lib/suap-sync';

const projetoSuap = {
  id: 123,
  titulo: 'Horta Comunitária',
  situacao: 'em execução',
  resumo: 'Resumo do SUAP',
  nome_coordenador: 'Maria',
  email_coordenador: 'maria@ifpr.edu.br',
  dt_inicio: '2026-01-01',
  dt_final: '2026-12-31',
  _fonte: 'extensao',
};

beforeEach(() => {
  vi.clearAllMocks();
  suapApiMock.fetchProjetosFromSuap.mockResolvedValue({ projetos: [projetoSuap], avisos: [] });
  suapApiMock.mapStatusProjeto.mockReturnValue('EM_EXECUCAO');
  prismaMock.projeto.findFirst.mockResolvedValue(null);
  prismaMock.syncLog.create.mockResolvedValue({});
  sinteticoMock.sincronizarProjetoSintetico.mockResolvedValue(undefined);
  prismaMock.projeto.create.mockResolvedValue({ id: 'novo-id' });
  prismaMock.projeto.update.mockResolvedValue({ id: 'existente-id' });
});

describe('suapIdUnico — chave de identidade', () => {
  it('mantém o id de pesquisa como está', () => {
    expect(suapIdUnico('pesquisa', 123)).toBe(123);
  });

  it('usa id negativo para extensão (evita colisão com pesquisa)', () => {
    expect(suapIdUnico('extensao', 123)).toBe(-123);
  });

  it('pesquisa 123 e extensão 123 NÃO colidem', () => {
    expect(idsColidem({ fonte: 'pesquisa', id: 123 }, { fonte: 'extensao', id: 123 })).toBe(false);
  });

  it('mesmo id e mesma fonte colidem (é o mesmo registro)', () => {
    expect(idsColidem({ fonte: 'extensao', id: 7 }, { fonte: 'extensao', id: 7 })).toBe(true);
  });

  it('é estável: a mesma entrada sempre gera a mesma chave', () => {
    const primeira = suapIdUnico('extensao', 42);
    const segunda = suapIdUnico('extensao', 42);

    expect(primeira).toBe(segunda);
  });

  it('fonte desconhecida é tratada como pesquisa (não inventa negativo)', () => {
    expect(suapIdUnico(undefined, 10)).toBe(10);
    expect(suapIdUnico(null, 10)).toBe(10);
  });
});

describe('syncProjetos — rodar 2x não duplica', () => {
  it('primeira execução (projeto inédito) cria', async () => {
    prismaMock.projeto.findUnique.mockResolvedValue(null);

    const resultado = await syncProjetos();

    expect(prismaMock.projeto.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.projeto.update).not.toHaveBeenCalled();
    expect(resultado.criados).toBe(1);
    expect(resultado.atualizados).toBe(0);
  });

  it('segunda execução encontra pelo suapId e atualiza (não cria de novo)', async () => {
    prismaMock.projeto.findUnique.mockResolvedValue({
      id: 'existente-id',
      slug: 'horta-comunitaria',
      nome: 'Horta Comunitária',
      suapSyncedAt: new Date(),
      updatedAt: new Date(),
    });

    const resultado = await syncProjetos();

    expect(prismaMock.projeto.create).not.toHaveBeenCalled();
    expect(prismaMock.projeto.update).toHaveBeenCalledTimes(1);
    expect(resultado.criados).toBe(0);
    expect(resultado.atualizados).toBe(1);
  });

  it('consulta o registro pela chave derivada da fonte (extensão = id negativo)', async () => {
    prismaMock.projeto.findUnique.mockResolvedValue(null);

    await syncProjetos();

    expect(prismaMock.projeto.findUnique).toHaveBeenCalledWith({ where: { suapId: -123 } });
    expect(prismaMock.projeto.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ suapId: -123 }) }),
    );
  });

  it('dry-run não grava nada (nem cria, nem atualiza)', async () => {
    const resultado = await syncProjetos({ dryRun: true });

    expect(prismaMock.projeto.create).not.toHaveBeenCalled();
    expect(prismaMock.projeto.update).not.toHaveBeenCalled();
    expect(resultado.detalhes.join(' ')).toMatch(/dry-run/i);
  });

  it('erro na busca do SUAP é reportado e não cria projeto nenhum', async () => {
    suapApiMock.fetchProjetosFromSuap.mockRejectedValue(new Error('SUAP fora do ar'));

    const resultado = await syncProjetos();

    expect(resultado.erros).toBeGreaterThan(0);
    expect(resultado.detalhes.join(' ')).toContain('SUAP fora do ar');
    expect(prismaMock.projeto.create).not.toHaveBeenCalled();
  });
});
