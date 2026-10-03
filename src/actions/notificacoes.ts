'use server';

import { prisma } from '@/lib/prisma';
import { resolverUsuarioDaSessao } from '@/lib/usuario-sessao';
import { contarNaoLidas } from '@/lib/minha-area';

/**
 * Notificações internas do estudante (ROADMAP 6.2).
 *
 * Aqui só existem LEITURA e marcação como lida, sempre restritas ao usuário da
 * sessão. Quem CRIA notificação é o produtor em `src/lib/notificacoes.ts`, que
 * não é Server Action de propósito — expor um "criar notificação para qualquer
 * usuário" como endpoint seria um vetor de spam/phishing dentro do portal.
 */

export type NotificacaoItem = {
  id: string;
  titulo: string;
  texto: string | null;
  link: string | null;
  lida: boolean;
  created_at: string;
};

export async function listarMinhasNotificacoes(
  idToken: string,
  limite = 30,
): Promise<NotificacaoItem[]> {
  const sessao = await resolverUsuarioDaSessao(idToken);
  if (!sessao.ok) return [];

  const notificacoes = await prisma.notificacao.findMany({
    where: { user_id: sessao.userId },
    orderBy: { created_at: 'desc' },
    take: Math.min(Math.max(limite, 1), 100),
  });

  return notificacoes.map((n) => ({
    id: n.id,
    titulo: n.titulo,
    texto: n.texto,
    link: n.link,
    lida: n.lida,
    created_at: n.created_at.toISOString(),
  }));
}

/** Só o contador — o sino do cabeçalho não precisa baixar a lista inteira. */
export async function contarMinhasNaoLidas(idToken: string): Promise<number> {
  const sessao = await resolverUsuarioDaSessao(idToken);
  if (!sessao.ok) return 0;

  const naoLidas = await prisma.notificacao.findMany({
    where: { user_id: sessao.userId, lida: false },
    select: { lida: true },
  });

  return contarNaoLidas(naoLidas);
}

export async function marcarNotificacaoLida(
  idToken: string,
  notificacaoId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sessao = await resolverUsuarioDaSessao(idToken);
  if (!sessao.ok) return sessao;

  try {
    // `user_id` no where é o que garante a posse: sem ele, qualquer pessoa
    // autenticada poderia marcar como lida a notificação de outra.
    await prisma.notificacao.updateMany({
      where: { id: notificacaoId, user_id: sessao.userId },
      data: { lida: true },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'Não foi possível marcar como lida' };
  }
}

export async function marcarTodasNotificacoesLidas(
  idToken: string,
): Promise<{ ok: true; atualizadas: number } | { ok: false; error: string }> {
  const sessao = await resolverUsuarioDaSessao(idToken);
  if (!sessao.ok) return sessao;

  try {
    const { count } = await prisma.notificacao.updateMany({
      where: { user_id: sessao.userId, lida: false },
      data: { lida: true },
    });
    return { ok: true, atualizadas: count };
  } catch {
    return { ok: false, error: 'Não foi possível marcar as notificações como lidas' };
  }
}
