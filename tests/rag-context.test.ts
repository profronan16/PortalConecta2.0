import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  search: vi.fn(), embedding: vi.fn(),
  prisma: { $queryRaw: vi.fn(), documentoKb: { findMany: vi.fn() }, projeto: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() }, edital: { count: vi.fn(), findMany: vi.fn() } },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mock.prisma }));
vi.mock('@/lib/embeddings', () => ({ generateEmbedding: mock.embedding }));
vi.mock('@/lib/busca-vetorial', async original => ({ ...await original<typeof import('@/lib/busca-vetorial')>(), searchSimilarChunks: mock.search }));
import { buscarContextoChat, interpretarConsulta } from '@/lib/chat-context';
const chunk = { id: 'c1', documento_id: 'd1', documento_titulo: 'Manual', documento_tipo: 'manual', texto: 'O código do manual é ALFA.', similarity: 0.8, metadata: {}, secao: null };
beforeEach(() => {
  vi.clearAllMocks(); mock.embedding.mockRejectedValue(new Error('Gemini indisponível'));
  mock.search.mockResolvedValue([chunk]);
  mock.prisma.documentoKb.findMany.mockResolvedValue([{ id: 'd1', titulo: 'Manual', tipo: 'manual', metadata: {} }]);
  mock.prisma.projeto.findMany.mockResolvedValue([]); mock.prisma.projeto.count.mockResolvedValue(0);
  mock.prisma.edital.findMany.mockResolvedValue([]); mock.prisma.edital.count.mockResolvedValue(0);
  mock.prisma.$queryRaw.mockResolvedValue([{ id: 'edital-12' }]);
});
describe('recuperação e filtros', () => {
  it('a falha do Gemini preserva evidência textual e link consultável', async () => {
    const result = await buscarContextoChat('código do manual');
    expect(result.contexto).toContain('ALFA'); expect(result.mode).toBe('textual');
    expect(result.fontes[0].url).toBe('/ifizinha/fontes/d1');
  });
  it('falha de banco não é confundida com pesquisa sem resultado', async () => {
    mock.search.mockRejectedValue(new Error('banco offline'));
    await expect(buscarContextoChat('manual')).rejects.toThrow('Recuperação indisponível');
  });
  it('documento ocultado depois da recuperação não entra no contexto', async () => {
    mock.prisma.documentoKb.findMany.mockResolvedValue([]);
    expect((await buscarContextoChat('manual')).fontes).toEqual([]);
  });
  it('não troca fonte antiga oculta por outra na continuação', async () => {
    const result = await buscarContextoChat('prazo do manual', undefined, ['antigo']);
    expect(result.mode).toBe('fonte-indisponivel'); expect(result.contexto).toBe('');
  });
  it('aplica status e número de edital, e conta com os mesmos filtros', async () => {
    await buscarContextoChat('Quais editais abertos? edital 12/2026');
    const { where } = mock.prisma.edital.findMany.mock.calls[0][0];
    expect(where.status).toBe('ABERTO'); expect(where.id.in).toEqual(['edital-12']);
    expect(mock.prisma.edital.count).toHaveBeenCalledWith({ where });
  });
  it('tema sem resultado não provoca remoção de filtros', async () => {
    await buscarContextoChat('projetos de robótica');
    // Sem aberto: tenta abertos, em andamento e encerrados, sempre com o filtro de tema; nunca amplia sem o tema.
    for (const [{ where }] of mock.prisma.projeto.count.mock.calls) expect(where.AND.some((c: { OR?: unknown[] }) => c.OR && c.OR.length > 2)).toBe(true);
    expect(mock.prisma.projeto.count.mock.calls.at(-1)![0].where.AND).toHaveLength(1);
    expect(mock.prisma.projeto.findMany).toHaveBeenCalledTimes(2); // nomes + lista, sem retry ampliado
  });
  it('não confunde artes com parte de outra palavra', () => expect(interpretarConsulta('projetos participantes').themes).toEqual([]));
  it('tema específico desconhecido não é trocado por fontes genéricas', async () => {
    const result = await buscarContextoChat('projetos de teletransporte quântico interplanetário');
    expect(result.fontes).toEqual([]);
    expect(result.contexto).toContain('0 correspondem');
  });
  it('encerra filtros de abertos quando o pedido é de encerrados', () => expect(interpretarConsulta('editais encerrados').open).toBe(false));
  it('reconhece pedido misto de projetos e editais', () => {
    const intent = interpretarConsulta('projetos e editais de pesquisa');
    expect(intent.project && intent.edital).toBe(true);
  });
  it('não transforma pesquisa existem em nome de projeto', async () => {
    await buscarContextoChat('Quantos projetos de pesquisa existem?');
    const { where } = mock.prisma.projeto.count.mock.calls.at(-1)![0]; // sem aberto, o último recorte é o do filtro puro
    expect(where.tipo.contains).toBe('pesquisa'); expect(where.AND).toBeUndefined();
  });
});
