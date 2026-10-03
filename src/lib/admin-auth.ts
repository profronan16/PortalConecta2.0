import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySessionToken } from '@/lib/auth-helpers';
import { isAdministradorGeral } from '@/lib/permissions';

/**
 * Autorização das rotas administrativas por ID token do Firebase.
 *
 * Motivo: as rotas `/api/admin/*` recebiam o e-mail do administrador por query
 * string ou corpo JSON e conferiam o papel DESSE e-mail no banco — ou seja,
 * confiavam na identidade afirmada pelo cliente. Como os e-mails administrativos
 * estão na documentação pública do projeto, qualquer pessoa podia se passar por
 * admin (o mesmo problema corrigido antes em `/api/files/upload`).
 *
 * Agora o cliente manda o ID token no header padrão:
 *
 *     Authorization: Bearer <idToken do Firebase>
 *
 * O token é o único lugar de onde a identidade sai: `verifySessionToken` confere
 * a assinatura no servidor (firebase-admin) e devolve o e-mail real. O header é
 * preferível a query string porque URL aparece em log de acesso e histórico.
 */

export type ResultadoAuthAdmin =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403; error: string };

/** Extrai o token do header `Authorization: Bearer <token>`. */
export function tokenDeAutorizacao(request: NextRequest): string | undefined {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return undefined;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

/** Verifica o token e devolve o e-mail real (ou o motivo da recusa). */
async function autenticar(request: NextRequest): Promise<{ ok: true; email: string } | { ok: false; status: 401; error: string }> {
  const sessao = await verifySessionToken(tokenDeAutorizacao(request));
  if (!sessao.ok) {
    return { ok: false, status: 401, error: sessao.error };
  }
  return { ok: true, email: sessao.email };
}

/** Exige papel ADMIN no banco (autenticação por token). */
export async function exigirAdmin(request: NextRequest): Promise<ResultadoAuthAdmin> {
  const autenticacao = await autenticar(request);
  if (!autenticacao.ok) return autenticacao;

  const user = await prisma.user.findUnique({
    where: { email: autenticacao.email },
    select: { role: true },
  });

  if (user?.role !== 'ADMIN') {
    return { ok: false, status: 403, error: 'Acesso negado: apenas administradores' };
  }

  return { ok: true, email: autenticacao.email };
}

/** Exige o Administrador Geral (o e-mail mestre de ADMIN_EMAILS). */
export async function exigirAdministradorGeral(request: NextRequest): Promise<ResultadoAuthAdmin> {
  const autenticacao = await autenticar(request);
  if (!autenticacao.ok) return autenticacao;

  if (!isAdministradorGeral(autenticacao.email)) {
    return { ok: false, status: 403, error: 'Acesso negado: apenas o Administrador Geral' };
  }

  return { ok: true, email: autenticacao.email };
}
