/**
 * Regras puras do chat da IFizinha para: atualidade das fontes, links absolutos,
 * pedidos do tipo "onde encontro o documento X" e perguntas sobre a Agenda.
 *
 * Fica separado de `chat-context.ts` para ser testado sem banco.
 */
import { normalizarPergunta } from '@/lib/chat-policy';

export const BASE_PUBLICA = (process.env.PUBLIC_SITE_URL || 'https://portal.ifcoding.com.br').replace(/\/+$/, '');

/** A Agenda do chat só considera eventos de 2026 em diante (pedido do campus). */
export const AGENDA_DESDE = new Date('2026-01-01T00:00:00.000Z');

/** Ano de uma fonte (metadados do documento, caminho do WordPress ou título). */
export function anoDaFonte(metadata: unknown, titulo = ''): number | null {
  const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;
  for (const chave of ['ultima_atualizacao', 'data_publicacao']) {
    const valor = meta[chave];
    const ano = typeof valor === 'string' ? valor.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/)?.[1] : undefined;
    if (ano) return Number(ano);
  }
  const url = [meta.url_documento_original, meta.url_fonte].find(v => typeof v === 'string') as string | undefined;
  const doCaminho = url?.match(/\/uploads\/(?:sites\/\d+\/)?((?:19|20)\d{2})\//)?.[1];
  if (doCaminho) return Number(doCaminho);
  const doTitulo = titulo.match(/(?:^|\D)(20[0-3]\d)(?:\D|$)/)?.[1];
  return doTitulo ? Number(doTitulo) : null;
}

/** Peso aplicado ao ranking: o dado mais atual vence quando a relevância é parecida. */
export function fatorRecencia(ano: number | null, anoAtual: number): number {
  if (ano === null) return 0.85;
  const idade = anoAtual - ano;
  if (idade <= 0) return 1;
  if (idade === 1) return 0.93;
  if (idade === 2) return 0.82;
  return 0.7;
}

/** Texto que acompanha a evidência para o modelo avisar sobre documentos antigos. */
export function rotuloAtualidade(ano: number | null, anoAtual: number): string {
  if (ano === null) return 'Ano da fonte: não informado (confira se continua vigente)';
  if (anoAtual - ano >= 2) return `Ano da fonte: ${ano} — ANTIGO: a informação pode ter mudado, avise a pessoa e indique conferir o site oficial`;
  return `Ano da fonte: ${ano}`;
}

export function urlAbsoluta(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `${BASE_PUBLICA}${url.startsWith('/') ? '' : '/'}${url}`;
}

const STOP = new Set(['onde', 'aonde', 'como', 'qual', 'quais', 'que', 'um', 'uma', 'o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'e', 'para', 'por', 'com', 'eu', 'me', 'se', 'ha', 'tem', 'ter', 'esta', 'estao', 'fica', 'posso', 'consigo', 'encontro', 'encontrar', 'acho', 'achar', 'acessar', 'acesso', 'baixar', 'baixo', 'pego', 'pegar', 'link', 'documento', 'arquivo', 'disponivel', 'disponiveis', 'preciso', 'quero', 'gostaria', 'saber', 'favor', 'ifpr', 'ivaipora', 'campus', 'pode', 'poderia', 'voce', 'ifizinha']);

export function termosSignificativos(texto: string, max = 5): string[] {
  const palavras = normalizarPergunta(texto).replace(/[^a-z0-9\s/]/g, ' ').split(/\s+/).filter(Boolean);
  const unicos = [...new Set(palavras.filter(p => p.length >= 3 && !STOP.has(p)))];
  return unicos.slice(0, max);
}

/** "Onde encontro o modelo de relatório?" / "link do formulário de estágio". */
export function pedidoDeDocumento(pergunta: string): { pedido: boolean; termos: string[] } {
  const p = normalizarPergunta(pergunta);
  const onde = /\b(onde|aonde)\b.{0,50}\b(encontr|ach|acess|baix|consig|fica|esta|estao|tem|disponivel|pego|localiz|vejo|ver)/.test(p);
  const link = /\b(link|endereco|url|site)\s+(d[oae]s?|para|pra)\b/.test(p) || /\b(me (passa|manda|envia|mande|passe|envie)|qual (e )?o link)\b/.test(p);
  const baixar = /\b(baixar|download|imprimir|preencher)\b/.test(p) && /\b(modelo|formulario|ficha|anexo|termo|declaracao|requerimento|relatorio|planilha)\b/.test(p);
  const modelo = /^(modelo|formulario|ficha|template)\b/.test(p.trim());
  const pedido = onde || link || baixar || modelo;
  return { pedido, termos: pedido ? termosSignificativos(pergunta) : [] };
}

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const AGENDA = /\b(agenda|calendario|eventos?|feriados?|recesso|reuniao|reunioes|palestras?|ferias|dia letivo|sabado letivo|(proximos?|proximas?) (eventos?|prazos?|datas?)|quando (comeca|comecam|termina|terminam|acontece|ocorre|sera|serao|e|sao|vai|vao)|(inicio|termino|fim|final) d[eoa]s? (aulas|semestre|periodo|ano letivo|bimestre|trimestre)|data d[eoa]s? (matricula|rematricula|prova|prova final|exame|formatura))\b/;
/** Palavras que indicam a Agenda mas não ajudam a localizar um evento específico. */
const STOP_AGENDA = new Set([...STOP, 'agenda', 'calendario', 'evento', 'eventos', 'quando', 'proximo', 'proximos', 'proxima', 'proximas', 'tem', 'vai', 'sera', 'serao', 'comeca', 'termina', 'acontece', 'ocorre', 'data', 'datas', 'dia', 'dias', 'hoje', 'amanha', 'semana', 'mes', 'ano', 'letivo', 'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro', 'inicio', 'termino', 'fim', 'final', 'academico', 'academica', 'campus', 'proximos']);

export function consultaDeAgenda(pergunta: string, anoAtual: number): { agenda: boolean; termos: string[]; periodo?: { inicio: Date; fim: Date } } {
  const p = normalizarPergunta(pergunta);
  if (!AGENDA.test(p)) return { agenda: false, termos: [] };
  const termos = [...new Set(p.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 4 && !STOP_AGENDA.has(t)))].slice(0, 4);
  const mes = MESES.findIndex(m => new RegExp(`\\b${m}\\b`).test(p));
  const ano = Number(p.match(/\b(20[2-3]\d)\b/)?.[1] || Math.max(anoAtual, 2026));
  const periodo = mes >= 0 ? { inicio: new Date(Date.UTC(ano, mes, 1)), fim: new Date(Date.UTC(ano, mes + 1, 1)) } : undefined;
  return { agenda: true, termos, periodo };
}

export function dataCivil(data: Date | null | undefined): string | null {
  return data ? data.toISOString().slice(0, 10) : null;
}

/** Acrescenta ao texto os links dos documentos pedidos que o modelo não escreveu. */
export function garantirLinksNaResposta(reply: string, documentos: Array<{ titulo: string; url: string | null }>): string {
  const faltando = documentos.filter(d => d.url && !reply.includes(urlAbsoluta(d.url)!) && !reply.includes(d.url!));
  if (!faltando.length) return reply;
  return `${reply.trimEnd()}\n\n**Links para acessar:**\n${faltando.map(d => `- [${d.titulo}](${urlAbsoluta(d.url)})`).join('\n')}`;
}
