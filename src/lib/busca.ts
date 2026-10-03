import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatDateShort, getStatusLabel } from '@/lib/utils';
import {
  BUSCA_LIMITE_POR_TIPO,
  TIPOS_BUSCA,
  normalizarLimite,
  normalizarTermoBusca,
  ordenarPorRelevancia,
  termoBuscaValido,
  type TipoBusca,
} from '@/lib/busca-filtros';

/**
 * Consultas da BUSCA GLOBAL (ROADMAP 6.6): projetos + editais + posts.
 *
 * O termo chega cru (`?q=`) e é normalizado pelas regras puras de
 * `@/lib/busca-filtros` — aqui só mora o acesso ao banco, no mesmo padrão de
 * separação de `/projetos` (`projetos-filtros.ts` × `projetos-publicos.ts`).
 *
 * Cada categoria é consultada em paralelo, com `count` + `findMany` no MESMO
 * `where`: assim o "5 de 37" da tela nunca diverge do que está listado.
 */

/** Um item exibido nos cards de resultado. */
export type ResultadoBusca = {
  tipo: TipoBusca;
  id: string;
  titulo: string;
  subtitulo: string | null;
  /** Caminho já pronto para o `<Link>` — montado aqui, não na UI. */
  href: string;
};

export type GrupoBusca = {
  tipo: TipoBusca;
  /** Total real da categoria (não o tamanho de `itens`). */
  total: number;
  itens: ResultadoBusca[];
};

export type BuscaGlobalResultado = {
  /** Termo normalizado (para exibir e remontar o formulário). */
  termo: string;
  /** `false` quando o termo é vazio/curto/longo demais — nada foi consultado. */
  valido: boolean;
  grupos: GrupoBusca[];
  /** Soma dos totais de todas as categorias. */
  total: number;
};

export type BuscaGlobalOpcoes = {
  /** Itens por categoria (default `BUSCA_LIMITE_POR_TIPO`). */
  limitePorTipo?: number;
  /** Restringe a busca a alguns tipos (default: todos). */
  tipos?: readonly TipoBusca[];
};

/** Visibilidade pública de projeto — mesma régua de `/projetos`. */
export const PROJETO_BUSCA_WHERE: Prisma.ProjetoWhereInput = {
  review_status: 'PUBLICADO',
  deleted_at: null,
};

/** Visibilidade pública de edital — mesma régua de `/editais`. */
export const EDITAL_BUSCA_WHERE: Prisma.EditalWhereInput = {
  review_status: 'PUBLICADO',
  deleted_at: null,
};

/**
 * Visibilidade pública de post.
 *
 * O campo que indica publicação do `Post` é `status` (enum `StatusPost`), não
 * `review_status` — é o critério que o resto do portal usa: a página do post
 * (`projetos/[slug]/posts/[postSlug]`) faz `where: { slug, status: 'PUBLICADO' }`
 * e a página do projeto lista `posts: { where: { status: 'PUBLICADO' } }`.
 * `listPosts` (admin) NÃO filtra por status de propósito, porque é a listagem
 * de gestão (mostra rascunhos) — por isso ela não serve de referência aqui.
 *
 * Além do status, o projeto pai precisa estar publicado e sem soft delete:
 * a busca é pública e um post "solto" de projeto despublicado levaria a um
 * link que não existe na área pública.
 */
export const POST_BUSCA_WHERE: Prisma.PostWhereInput = {
  status: 'PUBLICADO',
  projeto: PROJETO_BUSCA_WHERE,
};

/** Campos de texto procurados em Projeto (nome, descrição, coordenador, área). */
export function buildProjetoBuscaWhere(termo: string): Prisma.ProjetoWhereInput {
  return {
    ...PROJETO_BUSCA_WHERE,
    OR: [
      { nome: { contains: termo, mode: 'insensitive' } },
      { descricao: { contains: termo, mode: 'insensitive' } },
      { coordenador: { contains: termo, mode: 'insensitive' } },
      { area: { contains: termo, mode: 'insensitive' } },
    ],
  };
}

/** Campos de texto procurados em Edital (título, resumo, número). */
export function buildEditalBuscaWhere(termo: string): Prisma.EditalWhereInput {
  return {
    ...EDITAL_BUSCA_WHERE,
    OR: [
      { titulo: { contains: termo, mode: 'insensitive' } },
      { resumo: { contains: termo, mode: 'insensitive' } },
      { numero: { contains: termo, mode: 'insensitive' } },
    ],
  };
}

/** Campos de texto procurados em Post (título, resumo, conteúdo). */
export function buildPostBuscaWhere(termo: string): Prisma.PostWhereInput {
  return {
    ...POST_BUSCA_WHERE,
    OR: [
      { titulo: { contains: termo, mode: 'insensitive' } },
      { resumo: { contains: termo, mode: 'insensitive' } },
      // `conteudo` é HTML de rich text: o `contains` também casa com nome de
      // tag (ex.: buscar "img"). É o preço de procurar dentro do texto sem uma
      // coluna `tsvector` — que exigiria migração fora do escopo do 6.6.
      { conteudo: { contains: termo, mode: 'insensitive' } },
    ],
  };
}

/** Junta partes de subtítulo ignorando vazios: `['', 'X']` -> `'X'`. */
function juntarSubtitulo(partes: Array<string | null | undefined>): string | null {
  const limpas = partes.filter((p): p is string => Boolean(p && p.trim()));
  return limpas.length > 0 ? limpas.join(' • ') : null;
}

async function buscarProjetos(termo: string, limite: number): Promise<GrupoBusca> {
  const where = buildProjetoBuscaWhere(termo);

  const [total, projetos] = await Promise.all([
    prisma.projeto.count({ where }),
    prisma.projeto.findMany({
      where,
      orderBy: { nome: 'asc' },
      take: limite,
      select: {
        id: true,
        nome: true,
        slug: true,
        area: true,
        coordenador: true,
        status: true,
      },
    }),
  ]);

  const itens: ResultadoBusca[] = projetos.map((p) => ({
    tipo: 'projeto',
    id: p.id,
    titulo: p.nome,
    subtitulo: juntarSubtitulo([p.area, p.coordenador, getStatusLabel(p.status)]),
    href: `/projetos/${p.slug}`,
  }));

  return { tipo: 'projeto', total, itens: ordenarPorRelevancia(itens, termo) };
}

async function buscarEditais(termo: string, limite: number): Promise<GrupoBusca> {
  const where = buildEditalBuscaWhere(termo);

  const [total, editais] = await Promise.all([
    prisma.edital.count({ where }),
    prisma.edital.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limite,
      select: {
        id: true,
        titulo: true,
        slug: true,
        numero: true,
        categoria: true,
        status: true,
      },
    }),
  ]);

  const itens: ResultadoBusca[] = editais.map((e) => ({
    tipo: 'edital',
    id: e.id,
    titulo: e.titulo,
    subtitulo: juntarSubtitulo([
      e.numero ? `Nº ${e.numero}` : null,
      getStatusLabel(e.categoria),
      getStatusLabel(e.status),
    ]),
    href: `/editais/${e.slug}`,
  }));

  return { tipo: 'edital', total, itens: ordenarPorRelevancia(itens, termo) };
}

async function buscarPosts(termo: string, limite: number): Promise<GrupoBusca> {
  const where = buildPostBuscaWhere(termo);

  const [total, posts] = await Promise.all([
    prisma.post.count({ where }),
    prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: {
        id: true,
        titulo: true,
        slug: true,
        createdAt: true,
        projeto: { select: { nome: true, slug: true } },
      },
    }),
  ]);

  const itens: ResultadoBusca[] = posts.map((p) => ({
    tipo: 'post',
    id: p.id,
    titulo: p.titulo,
    subtitulo: juntarSubtitulo([p.projeto.nome, formatDateShort(p.createdAt)]),
    href: `/projetos/${p.projeto.slug}/posts/${p.slug}`,
  }));

  return { tipo: 'post', total, itens: ordenarPorRelevancia(itens, termo) };
}

/**
 * Despacha para o carregador da categoria. O `switch` é exaustivo sobre
 * `TipoBusca`, então adicionar um tipo novo em `busca-filtros.ts` quebra o
 * typecheck aqui até a consulta existir.
 */
function buscarPorTipo(tipo: TipoBusca, termo: string, limite: number): Promise<GrupoBusca> {
  switch (tipo) {
    case 'projeto':
      return buscarProjetos(termo, limite);
    case 'edital':
      return buscarEditais(termo, limite);
    case 'post':
      return buscarPosts(termo, limite);
  }
}

/**
 * Busca global por projetos, editais e posts publicados.
 *
 * Termo inválido (vazio, só espaços, 1 caractere, gigante) devolve
 * `{ valido: false }` SEM tocar no banco — a página usa isso para mostrar
 * orientação em vez de listar o portal inteiro.
 */
export async function buscarGlobal(
  termoBruto: string,
  opcoes: BuscaGlobalOpcoes = {},
): Promise<BuscaGlobalResultado> {
  const termo = normalizarTermoBusca(termoBruto);

  if (!termoBuscaValido(termo)) {
    return { termo, valido: false, grupos: [], total: 0 };
  }

  const limite = normalizarLimite(opcoes.limitePorTipo ?? BUSCA_LIMITE_POR_TIPO);
  const tipos = Array.from(new Set(opcoes.tipos ?? TIPOS_BUSCA));

  const grupos = await Promise.all(tipos.map((tipo) => buscarPorTipo(tipo, termo, limite)));

  return {
    termo,
    valido: true,
    grupos,
    total: grupos.reduce((acc, grupo) => acc + grupo.total, 0),
  };
}
