import xss from 'xss';

// Terceira tentativa de sanitizador nesta sessão — as duas anteriores
// (isomorphic-dompurify → jsdom → html-encoding-sniffer → @exodus/bytes, e
// depois sanitize-html → htmlparser2) derrubavam a produção na Vercel com
// `ERR_REQUIRE_ESM`: o runtime serverless da Vercel é mais rígido que o
// `next dev` local sobre `require()` de pacotes ESM-only, e ambas tinham
// uma dependência transitiva ESM-only nessa cadeia. `xss` (+ `commander` e
// `cssfilter`, suas únicas dependências) são pacotes antigos, puramente
// CommonJS, sem nenhuma dependência ESM na árvore — confirmado inspecionando
// os `package.json` de todos os três antes de trocar.

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'a',
  'ul', 'ol', 'li',
  'h2', 'h3', 'h4',
  'blockquote', 'code', 'pre', 'hr', 'span',
  'img',
];
const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt'],
};
const WHITE_LIST = Object.fromEntries(ALLOWED_TAGS.map((tag) => [tag, ALLOWED_ATTRIBUTES[tag] ?? []]));

/** Sanitiza HTML de origem confiável-mas-não-total (SUAP, editor rico) contra XSS. */
export function sanitizeHtml(html: string): string {
  return xss(html, { whiteList: WHITE_LIST, stripIgnoreTag: true, stripIgnoreTagBody: ['script', 'style'] });
}

const HTML_TAG_RE = /<([a-z][a-z0-9]*)\b[^>]*>/i;

/**
 * Normaliza um campo que pode conter texto puro (digitado à mão, sem tags)
 * ou HTML de rich text (ex.: `descricao` do projeto, que o sync do SUAP
 * preenche com o HTML do editor de texto rico do SUAP) para HTML seguro e
 * pronto pra renderizar com `SafeHtml`. Antes disso, campos assim eram
 * exibidos como texto puro (`descricao.split('\n\n')`) e tags do SUAP
 * apareciam cruas na tela.
 */
export function toSafeHtml(text: string | null | undefined): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';

  if (HTML_TAG_RE.test(trimmed)) {
    return sanitizeHtml(trimmed);
  }

  const escaped = trimmed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return sanitizeHtml(paragraphs);
}

/** Remove toda formatação — para teasers com line-clamp e `<meta description>`. */
export function stripHtml(text: string | null | undefined): string {
  if (!text) return '';
  const semTags = xss(text, { whiteList: {}, stripIgnoreTag: true, stripIgnoreTagBody: ['script', 'style'] });
  return semTags.replace(/\s+/g, ' ').trim();
}
