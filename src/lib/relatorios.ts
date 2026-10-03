'use server';

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isAdministradorGeral, whereUsuarioTemAcessoAoProjeto } from '@/lib/permissions';
import {
  agruparContagens,
  comPercentuais,
  contagensParaMapa,
  limitarComOutros,
  montarSerieCategoriasEdital,
  montarSerieStatus,
  montarSerieVagas,
  preencherSerieMensal,
  somarValores,
  type ContagemBruta,
  type ContagemMensal,
  type PontoSerie,
  type SerieVagas,
} from '@/lib/relatorios-series';

/**
 * Consultas agregadas dos relatórios avançados (ROADMAP 6.7).
 *
 * POR QUE ESTE MÓDULO É `'use server'`: as duas páginas de relatório são client
 * components (`'use client'`, usam `useAuth`) e precisam dos agregados. Marcar o
 * arquivo como Server Actions permite que elas chamem as funções daqui sem
 * levar o Prisma para o bundle do navegador — e sem criar rota de API nova.
 *
 * A AGREGAÇÃO ACONTECE NO BANCO (`groupBy`/`count`/`date_trunc`), nunca em JS
 * sobre a tabela inteira: `Inscricao` cresce a cada semestre e trafegar todas as
 * linhas para desenhar um gráfico de 6 fatias não se paga.
 *
 * As transformações (percentual, escala, ordem, meses vazios) ficam em
 * `src/lib/relatorios-series.ts`, que é puro e testado — aqui só buscamos os
 * números.
 */

/** Janela do gráfico mensal. 12 meses é o que cabe legível no eixo X. */
const MESES_JANELA = 12;

/** Áreas/categorias exibidas antes de agrupar a cauda em "Outros". */
const MAX_CATEGORIAS = 8;

type AdminRelatorioSeries = {
  /** Distribuição das inscrições por status (todos os projetos). */
  inscricoesPorStatus: PontoSerie[];
  /** Inscrições por mês, últimos 12 meses, meses vazios como 0. */
  inscricoesPorMes: ContagemBruta[];
  /** Projetos PUBLICADOS por área (catálogo público), top 8 + "Outros". */
  projetosPorArea: ContagemBruta[];
  /** Editais PUBLICADOS por categoria. */
  editaisPorCategoria: PontoSerie[];
  totalInscricoes: number;
  totalProjetosPublicados: number;
  totalEditaisPublicados: number;
};

type ProfessorRelatorioSeries = {
  /** Inscrições por status, apenas nos projetos do professor. */
  inscricoesPorStatus: PontoSerie[];
  /** Inscrições por mês, apenas nos projetos do professor. */
  inscricoesPorMes: ContagemBruta[];
  /** Vagas ofertadas x selecionados, por projeto. */
  vagasPorProjeto: SerieVagas[];
  totalProjetos: number;
  totalInscricoes: number;
  totalVagas: number;
  totalSelecionados: number;
};

/** Só o Administrador Geral (ou um usuário com papel ADMIN) vê números do portal inteiro. */
async function emailEhAdmin(email?: string): Promise<boolean> {
  if (!email) return false;
  if (isAdministradorGeral(email)) return true;
  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  return user?.role === 'ADMIN';
}

/** Primeiro dia do mês mais antigo da janela (used como corte inferior do SQL). */
function inicioDaJanelaMensal(meses = MESES_JANELA, referencia = new Date()): Date {
  return new Date(referencia.getFullYear(), referencia.getMonth() - (meses - 1), 1);
}

/**
 * Inscrições por mês agregadas no banco (`date_trunc` + `COUNT`) e depois
 * completadas com os meses vazios.
 *
 * Observação sobre fuso: o Prisma grava `created_at` em UTC e o `date_trunc`
 * agrupa por esse mês. O rótulo do eixo é montado em horário local, então uma
 * inscrição feita nas últimas horas do último dia do mês pode cair no balde do
 * mês seguinte e só aparecer no gráfico no dia seguinte. É uma diferença de no
 * máximo 3h em 2 dias por ano — não vale acoplar o relatório a um fuso fixo.
 */
async function buscarInscricoesPorMes(projetoIds?: readonly string[]): Promise<ContagemBruta[]> {
  // Sem projetos acessíveis não há o que contar (e `IN ()` seria SQL inválido).
  if (projetoIds && projetoIds.length === 0) {
    return preencherSerieMensal([], { quantidade: MESES_JANELA });
  }

  const desde = inicioDaJanelaMensal();
  const filtroProjetos = projetoIds
    ? Prisma.sql`AND projeto_id IN (${Prisma.join([...projetoIds])})`
    : Prisma.empty;

  const linhas = await prisma.$queryRaw<ContagemMensal[]>(Prisma.sql`
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS "periodo",
           COUNT(*)::int AS "total"
    FROM "Inscricao"
    WHERE created_at >= ${desde}
    ${filtroProjetos}
    GROUP BY 1
    ORDER BY 1
  `);

  return preencherSerieMensal(linhas, { quantidade: MESES_JANELA });
}

/**
 * Agregados do painel admin: visão geral do portal.
 *
 * Regra de visibilidade: relatórios de CATÁLOGO PÚBLICO (projetos por área,
 * editais por categoria) aplicam `review_status: 'PUBLICADO'` e
 * `deleted_at: null` — é o que o cidadão enxerga no site. Já as inscrições são
 * dado operacional interno (não existe inscrição pública sem projeto), então não
 * passam por esse filtro; filtrar por status de revisão aqui esconderia
 * inscrições reais de editais virados rascunho.
 */
export async function getAdminRelatorioSeries(
  email: string,
): Promise<{ ok: true; data: AdminRelatorioSeries } | { ok: false; error: string }> {
  if (!(await emailEhAdmin(email))) {
    return { ok: false, error: 'Acesso negado: apenas administradores' };
  }

  const [porStatus, porMes, projetosPorAreaBruto, editaisPorCategoriaBruto] = await Promise.all([
    prisma.inscricao.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    buscarInscricoesPorMes(),
    prisma.projeto.groupBy({
      by: ['area'],
      where: { review_status: 'PUBLICADO', deleted_at: null },
      _count: { _all: true },
    }),
    prisma.edital.groupBy({
      by: ['categoria'],
      where: { review_status: 'PUBLICADO', deleted_at: null },
      _count: { _all: true },
    }),
  ]);

  const inscricoesPorStatus = montarSerieStatus(
    contagensParaMapa(porStatus.map((linha) => ({ rotulo: linha.status, valor: linha._count._all }))),
  );

  // `Projeto.area` é texto livre: '' e '  ' viram "Não informada" e a cauda
  // longa vira "Outros" para o gráfico continuar legível.
  const projetosPorArea = comPercentuais(
    limitarComOutros(
      agruparContagens(
        projetosPorAreaBruto.map((linha) => ({ rotulo: linha.area, valor: linha._count._all })),
      ),
      MAX_CATEGORIAS,
    ),
  );

  const editaisPorCategoria = montarSerieCategoriasEdital(
    contagensParaMapa(
      editaisPorCategoriaBruto.map((linha) => ({
        rotulo: linha.categoria,
        valor: linha._count._all,
      })),
    ),
  );

  return {
    ok: true,
    data: {
      inscricoesPorStatus,
      inscricoesPorMes: porMes,
      projetosPorArea,
      editaisPorCategoria,
      totalInscricoes: somarValores(inscricoesPorStatus),
      totalProjetosPublicados: somarValores(projetosPorArea),
      totalEditaisPublicados: somarValores(editaisPorCategoria),
    },
  };
}

/**
 * Agregados do painel do professor — ESCOPO RESTRITO aos projetos dele
 * (coordenador, vice, admin do projeto ou coordenador cadastrado; o
 * Administrador Geral vê tudo, ver `src/lib/permissions.ts`).
 *
 * `projetoId` permite focar em um único projeto selecionado na tela; o filtro de
 * acesso continua sendo aplicado, então passar o id de um projeto alheio devolve
 * uma série vazia em vez de vazar dados.
 */
export async function getProfessorRelatorioSeries(
  email: string,
  projetoId?: string,
): Promise<{ ok: true; data: ProfessorRelatorioSeries } | { ok: false; error: string }> {
  if (!email) {
    return { ok: false, error: 'Não autenticado' };
  }

  const escopoProjeto: Prisma.ProjetoWhereInput = {
    // Projeto com soft delete não deve aparecer no relatório (mesma regra do site).
    deleted_at: null,
    ...(isAdministradorGeral(email) ? {} : whereUsuarioTemAcessoAoProjeto(email)),
    ...(projetoId ? { id: projetoId } : {}),
  };

  const projetos = await prisma.projeto.findMany({
    where: escopoProjeto,
    select: {
      id: true,
      nome: true,
      vagasBolsista: true,
      vagasVoluntario: true,
    },
    orderBy: { nome: 'asc' },
  });

  const projetoIds = projetos.map((projeto) => projeto.id);

  if (projetoIds.length === 0) {
    return {
      ok: true,
      data: {
        inscricoesPorStatus: montarSerieStatus({}),
        inscricoesPorMes: await buscarInscricoesPorMes([]),
        vagasPorProjeto: [],
        totalProjetos: 0,
        totalInscricoes: 0,
        totalVagas: 0,
        totalSelecionados: 0,
      },
    };
  }

  const [porStatus, porMes, vagasPorProjeto, selecionadosPorProjeto] = await Promise.all([
    prisma.inscricao.groupBy({
      by: ['status'],
      where: { projeto_id: { in: projetoIds } },
      _count: { _all: true },
    }),
    buscarInscricoesPorMes(projetoIds),
    prisma.vaga.groupBy({
      by: ['projetoId'],
      // Vaga CANCELADA não é oferta: contá-la inflaria o denominador e faria a
      // taxa de ocupação parecer pior do que é.
      where: { projetoId: { in: projetoIds }, status: { not: 'CANCELADA' } },
      _sum: { quantidade: true },
    }),
    prisma.inscricao.groupBy({
      by: ['projeto_id'],
      where: { projeto_id: { in: projetoIds }, status: 'selecionado' },
      _count: { _all: true },
    }),
  ]);

  const vagasPorId = new Map(
    vagasPorProjeto.map((linha) => [linha.projetoId, linha._sum.quantidade ?? 0]),
  );
  const selecionadosPorId = new Map(
    selecionadosPorProjeto.map((linha) => [linha.projeto_id, linha._count._all]),
  );

  const serieVagas = montarSerieVagas(
    projetos.map((projeto) => {
      // Projetos antigos podem não ter linhas em `Vaga` e usar só os campos
      // `vagasBolsista`/`vagasVoluntario` do próprio projeto — nesse caso eles
      // são a única informação de oferta disponível.
      const vagasCadastradas = vagasPorId.get(projeto.id) ?? 0;
      const total =
        vagasCadastradas > 0
          ? vagasCadastradas
          : (projeto.vagasBolsista ?? 0) + (projeto.vagasVoluntario ?? 0);

      return {
        rotulo: projeto.nome,
        total,
        preenchidas: selecionadosPorId.get(projeto.id) ?? 0,
      };
    }),
  );

  const inscricoesPorStatus = montarSerieStatus(
    contagensParaMapa(porStatus.map((linha) => ({ rotulo: linha.status, valor: linha._count._all }))),
  );

  return {
    ok: true,
    data: {
      inscricoesPorStatus,
      inscricoesPorMes: porMes,
      vagasPorProjeto: serieVagas,
      totalProjetos: projetos.length,
      totalInscricoes: somarValores(inscricoesPorStatus),
      totalVagas: serieVagas.reduce((acc, vaga) => acc + vaga.total, 0),
      totalSelecionados: serieVagas.reduce((acc, vaga) => acc + vaga.preenchidas, 0),
    },
  };
}
