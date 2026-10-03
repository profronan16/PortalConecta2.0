import { prisma } from '@/lib/prisma';
import { verifySessionToken } from '@/lib/auth-helpers';

/**
 * Resolve o usuário do banco a partir do ID token do Firebase.
 *
 * Evita repetir a mesma armadilha em toda action de autoatendimento: `User.id`
 * é um cuid (o login cria o usuário por e-mail, não pelo uid do Firebase), então
 * usar o `uid` do token como chave daria "usuário não encontrado". A ponte
 * confiável é o e-mail VERIFICADO do token.
 */
export type SessaoUsuario =
  | { ok: true; userId: string; email: string }
  | { ok: false; error: string };

export async function resolverUsuarioDaSessao(idToken?: string): Promise<SessaoUsuario> {
  const auth = await verifySessionToken(idToken);
  if (!auth.ok) return { ok: false, error: auth.error };

  const user = await prisma.user.findUnique({
    where: { email: auth.email },
    select: { id: true, email: true },
  });

  if (!user) return { ok: false, error: 'Perfil não encontrado — faça login novamente' };

  return { ok: true, userId: user.id, email: user.email };
}
