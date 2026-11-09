import { createHmac, timingSafeEqual } from 'crypto';

export const normalizarPergunta = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export function dataCivilAtual() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
type ChatState = { query: string; ids: string[]; expires: number };
function stateKey() { return process.env.CHAT_STATE_SECRET || process.env.DEEPSEEK_API_KEY; }
export function criarEstadoChat(query: string, ids: string[]) {
  const key = stateKey();
  if (!key) return undefined;
  const payload = Buffer.from(JSON.stringify({ query: query.slice(0, 2400), ids: ids.slice(0, 24), expires: Date.now() + 30 * 60_000 })).toString('base64url');
  const sig = createHmac('sha256', `chat-state-v1:${key}`).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function lerEstadoChat(raw: unknown): ChatState | null {
  if (typeof raw !== 'string' || raw.length > 12000 || !stateKey()) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', `chat-state-v1:${stateKey()}`).update(payload).digest('base64url');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof state.query === 'string' && Array.isArray(state.ids) && state.ids.every((v: unknown) => typeof v === 'string') && state.expires > Date.now() ? state : null;
  } catch { return null; }
}
export function resolverPergunta(message: string, state: ChatState | null) {
  const p = normalizarPergunta(message);
  const continuation = /^(e\s+(os?|as?|quanto|quais|como|para|prazo|documentos|requisitos|valores)\b|qual (o prazo|a data)|quais (os )?(documentos|requisitos)|como (me )?inscrev|e\?|nesse|nessa|dele|dela)/.test(p) || /\b(esse edital|este edital|desse projeto|deste projeto|fonte\s*\d+)\b/.test(p);
  // Pergunta que já traz o próprio assunto (número de edital, nome entre aspas ou vários termos) não depende da conversa anterior.
  const anaforico = /\b(esse edital|este edital|desse projeto|deste projeto|nesse|nessa|dele|dela|fonte\s*\d+)\b/.test(p);
  const traz = /\bedital\s*(?:n[ºo°.]?\s*)?\d{1,5}\b/.test(p) || /["“][^"”]{3,}["”]/.test(message) || p.split(/\s+/).filter(w => w.replace(/[^a-z0-9]/g, '').length >= 5).length >= 4;
  if (!continuation || (traz && !anaforico)) return { query: message, ids: [] as string[], clarify: false };
  if (!state) return { query: message, ids: [] as string[], clarify: true };
  if (state.ids.length > 1 && /\b(esse|este|desse|deste|dele|dela|fonte\s*\d+)\b/.test(p)) return { query: message, ids: [], clarify: true };
  return { query: `${state.query.split('\nPergunta de continuação:')[0]}\nPergunta de continuação: ${message}`.slice(0, 3000), ids: state.ids, clarify: false };
}
/** Limite conservador em bytes UTF-8: um token não contém menos que um byte.
 * Não depende do tokenizer do fornecedor; sacrifica capacidade em favor de um teto verificável. */
export function limitarEvidencias(blocks: Array<{ text: string; source: number | null }>, budget = 16000) {
  const selected: typeof blocks = [];
  let bytes = 0;
  for (const block of blocks) {
    const size = Buffer.byteLength(block.text, 'utf8');
    if (bytes + size > budget) continue; // não cortar uma evidência no meio
    selected.push(block); bytes += size;
  }
  return { selected, bytes, omitted: blocks.length - selected.length };
}
export function limparCitacoes(reply: string, allowed: number[]) {
  const valid = new Set(allowed);
  return reply.replace(/\[(\d+)\]/g, (match, id) => valid.has(Number(id)) ? match : '');
}
