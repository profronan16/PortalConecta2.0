/**
 * Regras puras da área do estudante: favoritos, notificações e alertas de
 * interesse (ROADMAP 6.2, 6.3 e 6.4).
 *
 * Módulo SEM importar `@/lib/prisma` de propósito: é usado também por
 * componentes client (botão de favoritar, sino de notificações, aba de alertas).
 * As consultas ficam em `src/actions/favoritos.ts`, `src/actions/notificacoes.ts`
 * e `src/actions/alertas.ts`.
 */

// ─── Favoritos ────────────────────────────────────────────────────────────────

export const ENTIDADES_FAVORITAVEIS = ['projeto', 'edital'] as const;
export type EntidadeFavoritavel = (typeof ENTIDADES_FAVORITAVEIS)[number];

/** Valida a entidade vinda do cliente — nunca confie no que chega. */
export function normalizarEntidade(valor: unknown): EntidadeFavoritavel | null {
  if (typeof valor !== 'string') return null;
  const normalizado = valor.trim().toLowerCase();
  return (ENTIDADES_FAVORITAVEIS as readonly string[]).includes(normalizado)
    ? (normalizado as EntidadeFavoritavel)
    : null;
}

/** Chave estável para o estado de favoritado no cliente (ex.: Set de ids). */
export function chaveFavorito(entidade: string, entidadeId: string): string {
  return `${entidade}:${entidadeId}`;
}

/** Para onde o favorito leva. */
export function hrefFavorito(entidade: EntidadeFavoritavel, slug: string): string {
  return entidade === 'projeto' ? `/projetos/${slug}` : `/editais/${slug}`;
}

export const ROTULO_ENTIDADE: Record<EntidadeFavoritavel, string> = {
  projeto: 'Projeto',
  edital: 'Edital',
};

// ─── Alertas de interesse ─────────────────────────────────────────────────────

/**
 * Categorias de edital que o estudante pode assinar.
 * Espelha o enum `CategoriaEdital` do Prisma (src/prisma/schema.prisma).
 */
export const CATEGORIAS_ALERTA = [
  'BOLSAS',
  'AUXILIOS',
  'EXTENSAO',
  'PESQUISA',
  'ENSINO',
  'EVENTOS',
  'ESTAGIOS',
  'RESULTADOS',
] as const;

export type CategoriaAlerta = (typeof CATEGORIAS_ALERTA)[number];

/**
 * Canais suportados hoje. `whatsapp` existe no schema (canal é String), mas não
 * há integração implementada — aceitar o valor daria a falsa impressão de que o
 * estudante vai receber mensagem.
 */
export const CANAIS_ALERTA = ['portal', 'email'] as const;
export type CanalAlerta = (typeof CANAIS_ALERTA)[number];

export function canalAlertaValido(valor: unknown): valor is CanalAlerta {
  return typeof valor === 'string' && (CANAIS_ALERTA as readonly string[]).includes(valor);
}

/** Mantém só categorias válidas, sem repetição e na ordem canônica. */
export function normalizarCategoriasAlerta(valor: unknown): CategoriaAlerta[] {
  if (!Array.isArray(valor)) return [];

  const recebidas = new Set(
    valor
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim().toUpperCase()),
  );

  return CATEGORIAS_ALERTA.filter((c) => recebidas.has(c));
}

export type ResultadoValidacaoAlerta =
  | { ok: true; canal: CanalAlerta; categorias: CategoriaAlerta[] }
  | { ok: false; error: string };

/** Valida o formulário de alerta antes de tocar no banco. */
export function validarAlerta(input: { canal?: unknown; categorias?: unknown }): ResultadoValidacaoAlerta {
  if (!canalAlertaValido(input.canal)) {
    return { ok: false, error: `Canal inválido — use ${CANAIS_ALERTA.join(' ou ')}` };
  }

  const categorias = normalizarCategoriasAlerta(input.categorias);

  // Lista vazia é permitida e significa "todas as categorias" (é o que o
  // schema já assume com o default []), mas avisamos na interface.
  return { ok: true, canal: input.canal, categorias };
}

export const ROTULO_CATEGORIA: Record<CategoriaAlerta, string> = {
  BOLSAS: 'Bolsas',
  AUXILIOS: 'Auxílios',
  EXTENSAO: 'Extensão',
  PESQUISA: 'Pesquisa',
  ENSINO: 'Ensino',
  EVENTOS: 'Eventos',
  ESTAGIOS: 'Estágios',
  RESULTADOS: 'Resultados',
};

/** "Todas as categorias" ou "Bolsas, Pesquisa" — usado na UI e no e-mail. */
export function resumoCategoriasAlerta(categorias: readonly string[]): string {
  if (categorias.length === 0) return 'Todas as categorias';
  return categorias
    .map((c) => ROTULO_CATEGORIA[c as CategoriaAlerta] ?? c)
    .join(', ');
}

/** Um edital interessa a este alerta? Lista vazia = todas as categorias. */
export function editalInteressaAoAlerta(
  categoriaEdital: string | null | undefined,
  categoriasAlerta: readonly string[],
): boolean {
  if (categoriasAlerta.length === 0) return true;
  if (!categoriaEdital) return false;
  return categoriasAlerta.includes(categoriaEdital);
}

// ─── Notificações ─────────────────────────────────────────────────────────────

export type NotificacaoResumida = { lida: boolean };

export function contarNaoLidas(notificacoes: readonly NotificacaoResumida[]): number {
  return notificacoes.reduce((total, n) => (n.lida ? total : total + 1), 0);
}

/** Rótulo curto do contador exibido no sino. */
export function rotuloContadorNaoLidas(total: number): string | null {
  if (total <= 0) return null;
  return total > 99 ? '99+' : String(total);
}

/**
 * Tempo relativo em português, sem dependência de i18n.
 * `agora` é injetável para o teste não depender do relógio.
 */
export function formatarTempoRelativo(data: Date | string, agora: Date = new Date()): string {
  const valor = data instanceof Date ? data : new Date(data);
  if (Number.isNaN(valor.getTime())) return '';

  const diffMs = agora.getTime() - valor.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;

  const diffHoras = Math.floor(diffMin / 60);
  if (diffHoras < 24) return `há ${diffHoras} h`;

  const diffDias = Math.floor(diffHoras / 24);
  if (diffDias === 1) return 'ontem';
  if (diffDias < 30) return `há ${diffDias} dias`;

  return valor.toLocaleDateString('pt-BR');
}
