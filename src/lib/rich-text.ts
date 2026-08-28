import sanitizeHtmlLib from 'sanitize-html';

// `sanitize-html` em vez de isomorphic-dompurify: aquele dependia de jsdom
// (via html-encoding-sniffer → @exodus/bytes, um pacote ESM-only carregado
// com require()), que quebrava no runtime serverless da Vercel com
// `ERR_REQUIRE_ESM` — derrubando com 500 qualquer rota que passasse por
// sanitização (inclusive /admin). A sanitização aqui só roda no servidor,
// nunca no navegador, então não precisamos de DOM real — sanitize-html é
// puro JS, sem essa cadeia de dependências frágil.

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'a',
  'ul', 'ol', 'li',
  'h2', 'h3', 'h4',
  'blockquote', 'code', 'pre', 'hr', 'span',
  'img',
];
const ALLOWED_ATTRIBUTES: sanitizeHtmlLib.IOptions['allowedAttributes'] = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt'],
};

/** Sanitiza HTML de origem confiável-mas-não-total (SUAP, editor rico) contra XSS. */
export function sanitizeHtml(html: string): string {
  return sanitizeHtmlLib(html, { allowedTags: ALLOWED_TAGS, allowedAttributes: ALLOWED_ATTRIBUTES });
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
  const semTags = sanitizeHtmlLib(text, { allowedTags: [], allowedAttributes: {} });
  return semTags.replace(/\s+/g, ' ').trim();
}
