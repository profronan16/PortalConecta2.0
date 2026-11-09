import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/embedding-quota', () => ({ reservarQuotaEmbedding: vi.fn(async () => undefined) }));
import { cache } from '@/lib/cache';
import { chunkDocument } from '@/lib/chunking';
import { validateEmbedding, generateBatchEmbeddings } from '@/lib/embeddings';
import { criarEstadoChat, lerEstadoChat, resolverPergunta, limparCitacoes, limitarEvidencias } from '@/lib/chat-policy';
import { filtrarFontesCitadas, type FonteResposta } from '@/lib/fontes-resposta';
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); cache.clear(); });
describe('expiração do cache', () => {
  it('respeita TTL por entrada, inclusive no instante da expiração', () => {
    vi.useFakeTimers(); cache.set('short', 1, 2000); cache.set('long', 2, 6000);
    vi.advanceTimersByTime(2000); expect(cache.get('short')).toBeNull(); expect(cache.get('long')).toBe(2);
  });
});
describe('integridade dos embeddings', () => {
  it('não gera vetores simulados sem chave', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    await expect(generateBatchEmbeddings(['documento'])).rejects.toThrow('não configurado');
  });
  it.each([NaN, Infinity, -Infinity])('valida também componentes depois do quinto (%s)', value => {
    const v = Array(1536).fill(0.1); v[1535] = value;
    expect(() => validateEmbedding(v)).toThrow();
  });
  it('rejeita vetor de norma zero', () => expect(() => validateEmbedding(Array(1536).fill(0))).toThrow());
  it('rejeita resposta de lote com menos vetores que textos', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ embeddings: [{ values: Array(1536).fill(0.1) }] })));
    await expect(generateBatchEmbeddings(['primeiro', 'segundo'], { apiKey: 'teste', attempts: 1 })).rejects.toThrow('Quantidade');
  });
});
describe('estado da conversa', () => {
  it('autentica estado, recusa adulteração e expiração', () => {
    vi.stubEnv('CHAT_STATE_SECRET', 'chave-teste'); vi.useFakeTimers();
    const state = criarEstadoChat('edital 12/2026', ['doc-1'])!;
    expect(lerEstadoChat(state)?.ids).toEqual(['doc-1']);
    expect(lerEstadoChat(`x${state}`)).toBeNull();
    vi.advanceTimersByTime(31 * 60000); expect(lerEstadoChat(state)).toBeNull();
  });
  it('continuação usa o assunto anterior e IDs estáveis', () => {
    const resolved = resolverPergunta('E os documentos?', { query: 'edital 12/2026', ids: ['d1'], expires: Date.now() + 1000 });
    expect(resolved.query).toContain('edital 12/2026'); expect(resolved.ids).toEqual(['d1']);
  });
  it('continuação sem estado pede esclarecimento', () => expect(resolverPergunta('E o prazo?', null).clarify).toBe(true));
  it('pergunta completa na primeira mensagem não pede esclarecimento', () => {
    expect(resolverPergunta('Qual o prazo do edital 999/2030?', null)).toMatchObject({ clarify: false, ids: [] });
    expect(resolverPergunta('Qual o prazo do edital de fluxo contínuo de extensão?', null).clarify).toBe(false);
    expect(resolverPergunta('Qual o prazo do edital 12/2026?', { query: 'edital 5/2025', ids: ['d1'], expires: Date.now() + 1000 }).ids).toEqual([]);
  });
  it('pergunta anafórica ou curta continua dependendo da conversa', () => {
    expect(resolverPergunta('Qual o prazo?', null).clarify).toBe(true);
    expect(resolverPergunta('E os requisitos desse edital?', null).clarify).toBe(true);
  });
  it('novo assunto não herda âncoras', () => expect(resolverPergunta('Qual o curso de agronomia?', { query: 'edital', ids: ['d1'], expires: 0 }).ids).toEqual([]));
});
describe('evidências e referências', () => {
  it('não corta blocos no meio nem ultrapassa orçamento UTF-8', () => {
    const result = limitarEvidencias([{ text: 'á'.repeat(10), source: 1 }, { text: 'fim', source: 2 }], 12);
    expect(result.selected.map(b => b.source)).toEqual([2]); expect(result.bytes).toBeLessThanOrEqual(12);
  });
  it('remove números inventados e mantém os válidos', () => expect(limparCitacoes('Prazo [1], veja [99].', [1])).toBe('Prazo [1], veja .'));
  it('preserva todas as fontes citadas, mesmo acima de seis', () => {
    const fontes = Array.from({ length: 9 }, (_, i) => ({ numero: i + 1, url: `/fonte/${i}` } as FonteResposta));
    expect(filtrarFontesCitadas('[1][2][3][4][5][6][7][8][9]', fontes)).toHaveLength(9);
  });
  it('overlap não faz um parágrafo ultrapassar o teto', () => {
    const text = `${'primeiro '.repeat(45)}\n\n${'segundo '.repeat(45)}`;
    expect(chunkDocument(text, { maxTokens: 70, overlapTokens: 30 }).every(c => c.texto.split(/\s+/).length <= 53)).toBe(true);
  });
});
