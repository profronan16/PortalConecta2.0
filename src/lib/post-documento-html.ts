/**
 * Post feito a partir de um ARQUIVO HTML (ex.: um manual da marca exportado
 * com CSS próprio, fontes e imagens embutidas em base64).
 *
 * Pedido da coordenação (2026-10-29): "subir o arquivo html e o portal aplicar
 * a formatação do documento como post, com as imagens, cores e estilos". O
 * editor rico não serve para isso: o `sanitizeHtml` (com razão) descarta
 * `<style>`, classes, SVG e scripts — sobraria só o texto.
 *
 * COMO O DOCUMENTO É EXIBIDO SEM RISCO PARA O PORTAL
 *
 * O documento roda num `<iframe srcdoc>` com `sandbox` SEM `allow-same-origin`:
 * para o navegador ele vem de uma origem opaca, então nenhum script dele lê
 * cookie, localStorage ou DOM do portal, nem navega a aba do portal. O CSS dele
 * também não vaza para o portal (e o do portal não estraga o dele). Por cima,
 * uma CSP injetada no próprio documento bloqueia `fetch`/XHR, envio de
 * formulário, iframes e scripts externos. É o mesmo modelo de isolamento dos
 * sites de "playground" de HTML.
 *
 * Scripts INLINE do documento continuam rodando (dentro da caixa de areia):
 * muitos documentos desenham partes do conteúdo com JavaScript — o manual da
 * marca que originou este recurso monta as variações do símbolo em SVG assim.
 *
 * Este arquivo é PURO (sem Prisma, sem fs): a mesma preparação roda no
 * navegador (pré-visualização) e no servidor (que grava e é quem decide).
 */
import { stripHtml } from '@/lib/rich-text';
import { LIMITES } from '@/lib/validacao';

/**
 * Teto do arquivo HTML. Fica abaixo do `bodySizeLimit` das Server Actions
 * (16 MB, em next.config.js) para que quem recuse seja a nossa mensagem, e não
 * um erro do framework.
 */
export const LIMITE_DOCUMENTO_HTML_BYTES = 10 * 1024 * 1024;

/** Extensões aceitas no seletor de arquivo. */
export const EXTENSOES_DOCUMENTO_HTML = ['.html', '.htm'] as const;

/** Prefixo das mensagens que o documento manda para a página (postMessage). */
export const MENSAGEM_DOCUMENTO = 'portal-post-html';

export function bytesDoTexto(texto: string): number {
  return new TextEncoder().encode(texto).length;
}

export function ehArquivoHtml(nome: string): boolean {
  const minusculo = nome.toLowerCase();
  return EXTENSOES_DOCUMENTO_HTML.some((ext) => minusculo.endsWith(ext));
}

/**
 * Remove do documento o que não tem lugar num post — antes de gravar.
 *
 * Não é aqui que mora a segurança (é o sandbox + CSP de `montarSrcdoc`); isto
 * tira o que, mesmo isolado, atrapalharia:
 *  - `<base>`: mudaria para onde apontam os links e imagens relativos;
 *  - `<meta http-equiv>`: um `refresh` redirecionaria o quadro, e uma CSP do
 *    próprio arquivo brigaria com a nossa;
 *  - `<iframe>`, `<frame>`, `<object>`, `<embed>`: conteúdo de terceiros
 *    aninhado (a CSP bloquearia de todo jeito; sai para não deixar buraco
 *    vazio na página).
 */
export function limparDocumentoHtml(html: string): string {
  return html
    .replace(/^﻿/, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*\bhttp-equiv\b[^>]*>/gi, '')
    .replace(/<(iframe|frame|frameset|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(iframe|frame|frameset|object|embed)\b[^>]*\/?>/gi, '')
    .trim();
}

/** Texto do `<title>` do documento, para sugerir o título do post. */
export function tituloDoDocumentoHtml(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const titulo = match ? stripHtml(match[1]) : '';
  return titulo || null;
}

/**
 * Texto do documento, sem formatação, em parágrafos simples — vai para
 * `Post.conteudo`.
 *
 * O post continua precisando de texto: é ele que a busca do portal encontra,
 * que vira o resumo do card e o `<meta description>`. `<head>` (título, CSS,
 * fontes) e `<script>`/`<style>` ficam de fora.
 */
export function conteudoTextualDoDocumento(html: string): string {
  const semHead = html
    .replace(/<head\b[\s\S]*?<\/head\s*>/i, '')
    .replace(/<title\b[\s\S]*?<\/title\s*>/gi, '')
    .replace(/<(script|style|svg|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    // Fim de bloco vira quebra, para o texto não sair numa linha só.
    .replace(/<\/(p|div|section|article|header|footer|li|h[1-6]|tr|figure|blockquote)\s*>/gi, '$&\n')
    .replace(/<br\s*\/?>/gi, '\n');

  // `stripHtml` junta tudo numa linha; aqui cada pedaço é limpo à parte.
  const paragrafos = semHead
    .split(/\n+/)
    .map((pedaco) => stripHtml(pedaco))
    .filter(Boolean);

  // Respeita o teto de `Post.conteudo` sem cortar no meio de um parágrafo. O
  // texto do `stripHtml` já sai seguro para HTML (entidades preservadas, `<`
  // solto escapado) — escapar de novo viraria "&amp;amp;" na tela.
  const teto = LIMITES.html.max - 100;
  let conteudo = '';
  for (const p of paragrafos) {
    const bloco = `<p>${p}</p>`;
    if (conteudo.length + bloco.length > teto) break;
    conteudo += bloco;
  }
  return conteudo;
}

export type DocumentoHtmlRecebido = { html?: unknown; nome?: unknown };

export type DocumentoHtmlValidado = {
  html: string;
  nomeArquivo: string | null;
  bytes: number;
  /** Texto para `Post.conteudo`. */
  conteudo: string;
};

/**
 * Valida o que o cliente mandou. Chamada pelo SERVIDOR antes de gravar (a tela
 * só faz uma checagem antecipada para avisar mais cedo).
 */
export function validarDocumentoHtml(
  entrada: DocumentoHtmlRecebido,
): { ok: true; valor: DocumentoHtmlValidado } | { ok: false; error: string } {
  if (typeof entrada?.html !== 'string' || !entrada.html.trim()) {
    return { ok: false, error: 'O arquivo HTML está vazio. Escolha outro arquivo.' };
  }

  const nomeArquivo = typeof entrada.nome === 'string' && entrada.nome.trim()
    ? entrada.nome.trim().slice(0, 200)
    : null;
  if (nomeArquivo && !ehArquivoHtml(nomeArquivo)) {
    return { ok: false, error: 'Envie um arquivo .html ou .htm.' };
  }

  const bruto = entrada.html;
  if (bytesDoTexto(bruto) > LIMITE_DOCUMENTO_HTML_BYTES) {
    return { ok: false, error: mensagemDocumentoGrande(bytesDoTexto(bruto)) };
  }

  const html = limparDocumentoHtml(bruto);
  const conteudo = conteudoTextualDoDocumento(html);
  // Sem texto nenhum, o post não aparece na busca nem tem resumo — e quase
  // sempre é arquivo errado (um HTML que só carrega um script externo).
  if (!conteudo) {
    return { ok: false, error: 'Não encontramos texto neste arquivo HTML. Confira se é o documento certo.' };
  }

  return { ok: true, valor: { html, nomeArquivo, bytes: bytesDoTexto(html), conteudo } };
}

export function mensagemDocumentoGrande(bytes: number): string {
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `O arquivo HTML tem ${mb(bytes)} e o limite é ${mb(LIMITE_DOCUMENTO_HTML_BYTES)}. ` +
    'Reduza as imagens embutidas e tente de novo.';
}

/**
 * CSP do documento. `https:` em imagens/estilos/fontes porque documentos
 * exportados costumam usar Google Fonts e imagens hospedadas; `connect-src`,
 * `form-action` e `frame-src` fechados: o documento não manda nada para fora
 * nem embute outros sites.
 */
const CSP_DOCUMENTO = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https:",
  'font-src data: https:',
  'img-src data: blob: https:',
  'media-src data: blob: https:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * Script injetado no documento (roda dentro do sandbox):
 *  - informa a altura do conteúdo, para o iframe crescer junto e a página ter
 *    uma rolagem só. A altura é o fundo do último elemento do `<body>`, e não
 *    o `scrollHeight`: este nunca fica menor que o próprio iframe, então o
 *    quadro só cresceria (ex.: girar o celular e voltar deixava um vão enorme
 *    no fim). Elementos `position: fixed` ficam de fora pelo mesmo motivo;
 *  - links de âncora (`#secao`) viram rolagem da página do portal — como o
 *    iframe não rola por dentro, o pulo interno não teria efeito visível;
 *  - os demais links abrem em nova aba, sem `opener`.
 */
const SCRIPT_PONTE = `(function(){
var P=${JSON.stringify(MENSAGEM_DOCUMENTO)},ultima=0;
function px(v){return parseFloat(v)||0}
function medir(){var b=document.body;if(!b)return 0;var y=window.scrollY,fundo=0,f=b.children;
for(var i=0;i<f.length;i++){var cs=getComputedStyle(f[i]);if(cs.position==="fixed"||cs.display==="none")continue;
var r=f[i].getBoundingClientRect();if(r.width||r.height)fundo=Math.max(fundo,r.bottom+y+px(cs.marginBottom));}
var s=getComputedStyle(b);return Math.ceil(fundo+px(s.paddingBottom)+px(s.borderBottomWidth)+px(s.marginBottom));}
function avisar(){var h=medir();
if(h>0&&Math.abs(h-ultima)>2){ultima=h;parent.postMessage({tipo:P+":altura",altura:h},"*");}}
addEventListener("load",avisar);addEventListener("resize",avisar);
document.addEventListener("DOMContentLoaded",function(){avisar();
if(window.ResizeObserver){var o=new ResizeObserver(avisar);o.observe(document.documentElement);if(document.body)o.observe(document.body);}});
document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;
var href=a.getAttribute("href")||"";
if(href.charAt(0)==="#"){e.preventDefault();var id=href.slice(1);try{id=decodeURIComponent(id)}catch(_){}
var alvo=id?document.getElementById(id):document.body;
if(alvo)parent.postMessage({tipo:P+":ancora",topo:alvo.getBoundingClientRect().top+window.scrollY},"*");return;}
a.setAttribute("target","_blank");a.setAttribute("rel","noopener noreferrer");},true);
})();`;

/**
 * Documento pronto para o `srcdoc`: a CSP e o script-ponte entram no INÍCIO do
 * `<head>` (a CSP só vale para o que vem depois dela).
 *
 * Arquivo sem `<!doctype>` ganha um: sem ele o navegador entra em "quirks
 * mode" e o layout sai diferente do que o autor viu (é o caso de HTML
 * exportado como fragmento, sem `<html>`/`<head>`).
 */
export function montarSrcdoc(html: string): string {
  const injecao =
    `<meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${CSP_DOCUMENTO}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<script>${SCRIPT_PONTE}</script>`;

  const doc = limparDocumentoHtml(html);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(doc);
  const corpo = doctype ? doc.slice(doctype[0].length) : doc;
  const prefixo = doctype ? doctype[0] : '<!doctype html>';

  const head = /<head\b[^>]*>/i.exec(corpo);
  if (head) {
    const fim = head.index + head[0].length;
    return prefixo + corpo.slice(0, fim) + injecao + corpo.slice(fim);
  }

  const htmlTag = /<html\b[^>]*>/i.exec(corpo);
  if (htmlTag) {
    const fim = htmlTag.index + htmlTag[0].length;
    return prefixo + corpo.slice(0, fim) + `<head>${injecao}</head>` + corpo.slice(fim);
  }

  return prefixo + `<head>${injecao}</head>` + corpo;
}
