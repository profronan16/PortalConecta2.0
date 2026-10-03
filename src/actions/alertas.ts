'use server';

import { prisma } from '@/lib/prisma';
import { resolverUsuarioDaSessao } from '@/lib/usuario-sessao';
import { validarAlerta, type CanalAlerta } from '@/lib/minha-area';

/**
 * Alertas de interesse do estudante (ROADMAP 6.4).
 *
 * O schema permite uma linha por (usuário, canal) — `@@unique([user_id, canal])`
 * — então a UI trabalha com um cartão por canal (portal, e-mail), cada um com
 * suas categorias e um liga/desliga.
 */

export type AlertaItem = {
  canal: string;
  categorias: string[];
  ativo: boolean;
  atualizadoEm: string;
};

export async function listarMeusAlertas(idToken: string): Promise<AlertaItem[]> {
  const sessao = await resolverUsuarioDaSessao(idToken);
  if (!sessao.ok) return [];

  const alertas = await prisma.alertaInteresse.findMany({
    where: { user_id: sessao.userId },
    orderBy: { canal: 'asc' },
  });

  return alertas.map((a) => ({
    canal: a.canal,
    categorias: a.categorias,
    ativo: a.ativo,
    atualizadoEm: a.created_at.toISOString(),
  }));
}

export async function salvarMeuAlerta(
  idToken: string,
  input: { canal: unknown; categorias: unknown; ativo?: unknown },
): Promise<{ ok: true; alerta: AlertaItem } | { ok: false; error: string }> {
  const sessao = await resolverUsuarioDaSessao(idToken);
  if (!sessao.ok) return sessao;

  const validado = validarAlerta(input);
  if (!validado.ok) return validado;

  const ativo = input.ativo === undefined ? true : Boolean(input.ativo);

  try {
    const alerta = await prisma.alertaInteresse.upsert({
      where: {
        user_id_canal: { user_id: sessao.userId, canal: validado.canal },
      },
      update: { categorias: validado.categorias, ativo },
      create: {
        user_id: sessao.userId,
        canal: validado.canal,
        categorias: validado.categorias,
        ativo,
      },
    });

    return {
      ok: true,
      alerta: {
        canal: alerta.canal,
        categorias: alerta.categorias,
        ativo: alerta.ativo,
        atualizadoEm: alerta.created_at.toISOString(),
      },
    };
  } catch {
    return { ok: false, error: 'Não foi possível salvar o alerta' };
  }
}

/** Remove o alerta do canal — "não quero receber nada por aqui". */
export async function removerMeuAlerta(
  idToken: string,
  canal: CanalAlerta,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sessao = await resolverUsuarioDaSessao(idToken);
  if (!sessao.ok) return sessao;

  try {
    await prisma.alertaInteresse.deleteMany({
      where: { user_id: sessao.userId, canal },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'Não foi possível remover o alerta' };
  }
}
