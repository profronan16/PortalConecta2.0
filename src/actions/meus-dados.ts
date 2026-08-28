'use server';

import { prisma } from '@/lib/prisma';
import { translatePrismaError } from '@/lib/utils';
import { verifySessionToken } from '@/lib/auth-helpers';
import type { Prisma } from '@prisma/client';

/**
 * Filtro das inscrições de um usuário logado. Precisa cobrir dois casos:
 * `email` (compatibilidade com inscrições antigas, feitas sem login, que só
 * têm o e-mail salvo) e `user_id` (inscrições feitas logado, onde o e-mail
 * do FORMULÁRIO pode ser diferente do e-mail da CONTA — a pessoa pode digitar
 * um e-mail de contato pessoal em vez do institucional. Sem o `user_id`,
 * essas inscrições nunca apareciam em "Meus Dados" porque a busca só
 * comparava e-mails).
 */
async function whereInscricoesDoUsuario(email: string): Promise<Prisma.InscricaoWhereInput> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return { OR: [{ email }, ...(user ? [{ user_id: user.id }] : [])] };
}

/**
 * Busca inscrições do estudante logado.
 * `idToken` é o ID token do Firebase (`user.getIdToken()` no cliente),
 * verificado no servidor via `verifySessionToken` — antes esta função
 * recebia um `email` comum e confiava nele (achado S3 do RELATORIO_TESTES.md:
 * qualquer chamada direta podia passar o e-mail de outra pessoa e ler suas
 * inscrições).
 */
export async function getMinhasInscricoes(idToken: string) {
  const auth = await verifySessionToken(idToken);
  if (!auth.ok) return [];

  const inscricoes = await prisma.inscricao.findMany({
    where: await whereInscricoesDoUsuario(auth.email),
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      protocolo: true,
      nome_completo: true,
      email: true,
      telefone: true,
      curso: true,
      turma: true,
      semestre: true,
      tipo_interesse: true,
      status: true,
      created_at: true,
      projeto: {
        select: {
          id: true,
          nome: true,
          slug: true,
          area: true,
          coordenador: true,
          corPrimaria: true,
        },
      },
    },
  });

  return inscricoes;
}

/**
 * Exporta inscrições do estudante logado em CSV
 */
export async function exportMinhasInscricoesCSV(idToken: string): Promise<string> {
  const headers = ['Protocolo', 'Projeto', 'Tipo Interesse', 'Status', 'Data'];

  const auth = await verifySessionToken(idToken);
  if (!auth.ok) return headers.join(',');

  const inscricoes = await prisma.inscricao.findMany({
    where: await whereInscricoesDoUsuario(auth.email),
    orderBy: { created_at: 'desc' },
    select: {
      protocolo: true,
      projeto: { select: { nome: true } },
      tipo_interesse: true,
      status: true,
      created_at: true,
    },
  });

  const rows = inscricoes.map((i) => [
    i.protocolo,
    i.projeto.nome,
    i.tipo_interesse,
    i.status,
    i.created_at.toLocaleDateString('pt-BR'),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
  return csv;
}

/**
 * Solicita exclusão de dados (LGPD) do estudante logado
 * Marca inscrições como "desistente" (não deleta por audit trail)
 */
export async function solicitarExclusaoDados(idToken: string, motivo?: string) {
  const auth = await verifySessionToken(idToken);
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    // Atualizar todas as inscrições do usuário para desistente
    const result = await prisma.inscricao.updateMany({
      where: await whereInscricoesDoUsuario(auth.email),
      data: {
        status: 'desistente',
        observacao_interna: `Exclusão solicitada via "Meus dados" em ${new Date().toLocaleDateString('pt-BR')}${motivo ? `. Motivo: ${motivo}` : ''}`,
      },
    });

    // Registrar no audit log
    await prisma.auditLog.create({
      data: {
        acao: 'solicitacao_exclusao_dados',
        entidade: 'inscricao',
        detalhes: {
          email: auth.email,
          inscricoes_afetadas: result.count,
          motivo: motivo || 'Não informado',
        },
      },
    });

    return { ok: true, count: result.count };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}
