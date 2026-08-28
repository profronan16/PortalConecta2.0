import { toSafeHtml } from '@/lib/rich-text';

/** Renderiza texto de rich text (HTML do SUAP, ou conteúdo do editor Tiptap) já sanitizado. */
export function SafeHtml({ html, className }: { html: string | null | undefined; className?: string }) {
  const safe = toSafeHtml(html);
  if (!safe) return null;
  // eslint-disable-next-line react/no-danger
  return <div className={className} dangerouslySetInnerHTML={{ __html: safe }} />;
}
