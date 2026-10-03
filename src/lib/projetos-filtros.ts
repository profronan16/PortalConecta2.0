import type { Prisma } from '@prisma/client';

/**
 * Regras puras da listagem pública de projetos (ROADMAP 1.15b).
 *
 * Este arquivo NÃO importa `@/lib/prisma` de propósito: ele é consumido também
 * pelo componente client `ProjetosExplorer` (montagem de URL, normalização de
 * filtros). Importar o Prisma aqui arrastaria o client do banco para o bundle
 * do navegador. As consultas vivem em `@/lib/projetos-publicos`.
 */

/** Tamanho de página da listagem pública. */
export const PROJETOS_PAGE_SIZE = 12;

/** Um projeto só é público se foi publicado e não sofreu soft delete. */
export const PROJETO_PUBLICO_WHERE: Prisma.ProjetoWhereInput = {
  review_status: 'PUBLICADO',
  deleted_at: null,
};

/** Campos exibidos nos cards. */
export const PROJETO_CARD_SELECT = {
  id: true,
  nome: true,
  slug: true,
  area: true,
  coordenador: true,
  status: true,
  corPrimaria: true,
  descricao: true,
  destaque: true,
} satisfies Prisma.ProjetoSelect;

export type ProjetoCard = {
  id: string;
  nome: string;
  slug: string;
  area: string;
  coordenador: string;
  status: string;
  corPrimaria: string;
  descricao: string | null;
  destaque: boolean;
};

export type ProjetoFiltroParams = {
  q?: string;
  area?: string;
  status?: string;
  page?: number;
};

export type ProjetoSearchParams = {
  q?: string | string[];
  area?: string | string[];
  status?: string | string[];
  page?: string | string[];
};

function primeiro(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? '';
}

/**
 * Normaliza os searchParams da URL. Função pura (testável sem banco).
 * Aceita `page` inválida/negativa/NaN e devolve sempre algo seguro.
 */
export function normalizarParamsProjetos(
  input: ProjetoSearchParams,
): Required<Pick<ProjetoFiltroParams, 'q' | 'area' | 'status' | 'page'>> {
  const pageRaw = Number.parseInt(primeiro(input.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  return {
    q: primeiro(input.q).slice(0, 100),
    area: primeiro(input.area),
    status: primeiro(input.status),
    page,
  };
}

/** Monta o `where` da listagem pública a partir dos filtros normalizados. */
export function buildProjetoWhere(params: ProjetoFiltroParams): Prisma.ProjetoWhereInput {
  const where: Prisma.ProjetoWhereInput = { ...PROJETO_PUBLICO_WHERE };

  const q = params.q?.trim();
  if (q) {
    // `mode: 'insensitive'` cobre diferenças de caixa sem depender da extensão
    // unaccent (que pode não estar instalada no banco).
    where.OR = [
      { nome: { contains: q, mode: 'insensitive' } },
      { coordenador: { contains: q, mode: 'insensitive' } },
      { area: { contains: q, mode: 'insensitive' } },
    ];
  }

  if (params.area) where.area = params.area;
  if (params.status) where.status = params.status as Prisma.ProjetoWhereInput['status'];

  return where;
}

/** Há algum filtro ativo? (a UI esconde os destaques nesse caso) */
export function temFiltroAtivo(params: ProjetoFiltroParams): boolean {
  return Boolean(params.q?.trim() || params.area || params.status);
}

/** Monta a URL preservando os filtros ao paginar/limpar. */
export function buildProjetosHref(params: ProjetoFiltroParams, page = 1): string {
  const search = new URLSearchParams();
  if (params.q?.trim()) search.set('q', params.q.trim());
  if (params.area) search.set('area', params.area);
  if (params.status) search.set('status', params.status);
  if (page > 1) search.set('page', String(page));

  const qs = search.toString();
  return qs ? `/projetos?${qs}` : '/projetos';
}

/** Lista de páginas a exibir na paginação, com elipses (-1) quando longa. */
export function paginasVisiveis(page: number, totalPages: number, janela = 2): number[] {
  const paginas = new Set<number>([1, totalPages]);
  for (let p = page - janela; p <= page + janela; p++) {
    if (p >= 1 && p <= totalPages) paginas.add(p);
  }

  const ordenadas = Array.from(paginas).sort((a, b) => a - b);
  const comEllipses: number[] = [];
  let anterior = 0;
  for (const p of ordenadas) {
    if (anterior && p - anterior > 1) comEllipses.push(-1);
    comEllipses.push(p);
    anterior = p;
  }
  return comEllipses;
}
