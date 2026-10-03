import { prisma } from '@/lib/prisma';
import {
  PROJETOS_PAGE_SIZE,
  PROJETO_CARD_SELECT,
  PROJETO_PUBLICO_WHERE,
  buildProjetoWhere,
  temFiltroAtivo,
  type ProjetoCard,
  type ProjetoFiltroParams,
} from '@/lib/projetos-filtros';

/**
 * Consultas da listagem PÚBLICA de projetos (ROADMAP 1.15b).
 *
 * Antes: `/projetos` carregava TODOS os projetos no servidor e mandava a lista
 * inteira para o cliente filtrar — o que (a) não escala, (b) mostrava rascunhos
 * e projetos com soft delete, porque a query não tinha `where` nenhum, e
 * (c) fazia o "Total" do topo divergir do resto do site.
 *
 * Agora: filtro + paginação no banco, com as regras puras em
 * `@/lib/projetos-filtros` (compartilhadas com o componente client).
 */

export type ProjetosPublicosResultado = {
  itens: ProjetoCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filtros: { areas: string[]; statuses: string[] };
  stats: { total: number; emExecucao: number; inscricoesAbertas: number };
  destaques: ProjetoCard[];
  filtrando: boolean;
};

/** Opções de filtro vindas do BANCO (não apenas da página atual). */
async function carregarFiltrosDisponiveis(): Promise<{ areas: string[]; statuses: string[] }> {
  const [areasRaw, statusesRaw] = await Promise.all([
    prisma.projeto.findMany({
      where: PROJETO_PUBLICO_WHERE,
      distinct: ['area'],
      select: { area: true },
      orderBy: { area: 'asc' },
    }),
    prisma.projeto.findMany({
      where: PROJETO_PUBLICO_WHERE,
      distinct: ['status'],
      select: { status: true },
    }),
  ]);

  return {
    areas: areasRaw.map((a) => a.area).filter((a): a is string => Boolean(a)),
    statuses: statusesRaw.map((s) => s.status as string),
  };
}

async function carregarStats(): Promise<ProjetosPublicosResultado['stats']> {
  const agrupado = await prisma.projeto.groupBy({
    by: ['status'],
    where: PROJETO_PUBLICO_WHERE,
    _count: { _all: true },
  });

  const porStatus = new Map<string, number>(
    agrupado.map((g) => [g.status as string, g._count._all]),
  );

  return {
    total: agrupado.reduce((acc, g) => acc + g._count._all, 0),
    emExecucao: porStatus.get('EM_EXECUCAO') ?? 0,
    inscricoesAbertas: porStatus.get('INSCRICOES_ABERTAS') ?? 0,
  };
}

/** Consulta única usada por `/projetos`: página + totais + filtros + destaques. */
export async function listProjetosPublicos(
  params: ProjetoFiltroParams,
): Promise<ProjetosPublicosResultado> {
  const page = params.page && params.page > 0 ? params.page : 1;
  const where = buildProjetoWhere(params);

  const [total, itens, filtros, stats, destaques] = await Promise.all([
    prisma.projeto.count({ where }),
    prisma.projeto.findMany({
      where,
      orderBy: { nome: 'asc' },
      skip: (page - 1) * PROJETOS_PAGE_SIZE,
      take: PROJETOS_PAGE_SIZE,
      select: PROJETO_CARD_SELECT,
    }),
    carregarFiltrosDisponiveis(),
    carregarStats(),
    prisma.projeto.findMany({
      where: { ...PROJETO_PUBLICO_WHERE, destaque: true },
      orderBy: { nome: 'asc' },
      take: 3,
      select: PROJETO_CARD_SELECT,
    }),
  ]);

  return {
    itens: itens as ProjetoCard[],
    total,
    page,
    pageSize: PROJETOS_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PROJETOS_PAGE_SIZE)),
    filtros,
    stats,
    destaques: destaques as ProjetoCard[],
    filtrando: temFiltroAtivo(params),
  };
}
