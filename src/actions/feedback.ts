'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getVerifiedServerSession } from '@/lib/session';
import { rateLimitado, obterIpCliente } from '@/lib/rate-limit';
import { verificarTurnstile } from '@/lib/turnstile';
import { criarNotificacao } from '@/lib/notificacoes';
import { MENSAGENS } from '@/lib/mensagens';
import {
  previaDaMensagem,
  rotuloDoTipo,
  statusValido,
  validarFeedback,
  type FeedbackEntrada,
  type StatusFeedback,
} from '@/lib/feedback';

/**
 * Feedback dos visitantes sobre o site.
 *
 * `enviarFeedback` é público (de propósito: quem tem problema para entrar também
 * precisa conseguir avisar), então se protege com limite por IP, CAPTCHA quando
 * configurado e campo-isca. As demais ações são só do Administrador Geral e a
 * identidade vem do cookie de sessão verificado no servidor — nunca de um
 * e-mail enviado pelo cliente.
 */

export type ResultadoEnvio = { ok: true } | { ok: false; error: string };

const ERRO_SEM_ACESSO = 'Você não tem acesso a esta área.';
const ERRO_GENERICO = 'Não foi possível concluir agora. Tente de novo em instantes.';
const MAX_LIMITE_POR_HORA = 5;

/** Quem enviou, se estiver logado. Falha na leitura da sessão não impede o envio. */
async function usuarioDaSessao(): Promise<string | null> {
  try {
    const sessao = await getVerifiedServerSession();
    if (!sessao?.email) return null;
    const usuario = await prisma.user.findUnique({ where: { email: sessao.email }, select: { id: true } });
    return usuario?.id ?? null;
  } catch {
    return null;
  }
}

export async function enviarFeedback(
  entrada: FeedbackEntrada,
  captchaToken?: string | null,
): Promise<ResultadoEnvio> {
  try {
    const validacao = validarFeedback(entrada);
    if (validacao.ok === 'descartado') return { ok: true };
    if (!validacao.ok) return { ok: false, error: validacao.error };

    const ip = obterIpCliente();
    const limite = await rateLimitado('feedback', ip, MAX_LIMITE_POR_HORA, 60 * 60_000);
    if (!limite.ok) {
      return { ok: false, error: 'Você já enviou várias mensagens nesta hora. Tente novamente mais tarde.' };
    }

    if (!(await verificarTurnstile(captchaToken, ip))) {
      return { ok: false, error: MENSAGENS.verificacaoSegurancaFalhou };
    }

    const { tipo, mensagem, contato, pagina } = validacao.dados;
    const userId = await usuarioDaSessao();

    await prisma.feedback.create({
      data: { tipo, mensagem, contato, pagina, user_id: userId },
    });

    await avisarAdministradores(tipo, mensagem);
    return { ok: true };
  } catch (e) {
    console.error('[feedback] falha ao gravar:', e instanceof Error ? e.message : 'erro desconhecido');
    return { ok: false, error: ERRO_GENERICO };
  }
}

/** Aviso no sino de cada administrador. Nunca lança: o feedback já foi gravado. */
async function avisarAdministradores(tipo: string, mensagem: string) {
  try {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    await Promise.all(
      admins.map((a) =>
        criarNotificacao({
          userId: a.id,
          titulo: `Novo feedback: ${rotuloDoTipo(tipo)}`,
          texto: previaDaMensagem(mensagem),
          link: '/admin/feedbacks',
        }),
      ),
    );
  } catch (e) {
    console.warn('[feedback] falha ao avisar administradores:', e instanceof Error ? e.message : 'erro desconhecido');
  }
}

// ── Administração ────────────────────────────────────────────────────────────

async function exigirAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const sessao = await getVerifiedServerSession();
  if (!sessao?.email) return { ok: false, error: 'Sua sessão expirou. Entre de novo no Portal.' };
  const usuario = await prisma.user.findUnique({ where: { email: sessao.email }, select: { role: true } });
  if (usuario?.role !== 'ADMIN') return { ok: false, error: ERRO_SEM_ACESSO };
  return { ok: true };
}

export type FeedbackItem = {
  id: string;
  tipo: string;
  mensagem: string;
  contato: string | null;
  pagina: string | null;
  status: StatusFeedback;
  criadoEm: string;
  autor: { nome: string | null; email: string } | null;
};

export type ListaFeedbacks = {
  itens: FeedbackItem[];
  total: number;
  pagina: number;
  porPagina: number;
  contagem: Record<StatusFeedback, number>;
};

const POR_PAGINA = 20;

export async function listarFeedbacks(
  filtro: { status?: string; pagina?: number } = {},
): Promise<{ ok: true; data: ListaFeedbacks } | { ok: false; error: string }> {
  const acesso = await exigirAdmin();
  if (!acesso.ok) return acesso;

  try {
    const status = statusValido(filtro.status) ? filtro.status : undefined;
    const pagina = Math.max(1, Math.floor(filtro.pagina ?? 1) || 1);
    const where = status ? { status } : {};

    const [linhas, total, porStatus] = await Promise.all([
      prisma.feedback.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
        include: { user: { select: { name: true, email: true } } },
      }),
      prisma.feedback.count({ where }),
      prisma.feedback.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const contagem: Record<StatusFeedback, number> = { novo: 0, lido: 0, resolvido: 0 };
    for (const g of porStatus) if (statusValido(g.status)) contagem[g.status] = g._count._all;

    return {
      ok: true,
      data: {
        itens: linhas.map((f) => ({
          id: f.id,
          tipo: f.tipo,
          mensagem: f.mensagem,
          contato: f.contato,
          pagina: f.pagina,
          status: statusValido(f.status) ? f.status : 'novo',
          criadoEm: f.created_at.toISOString(),
          autor: f.user ? { nome: f.user.name, email: f.user.email } : null,
        })),
        total,
        pagina,
        porPagina: POR_PAGINA,
        contagem,
      },
    };
  } catch (e) {
    console.error('[feedback] falha ao listar:', e instanceof Error ? e.message : 'erro desconhecido');
    return { ok: false, error: ERRO_GENERICO };
  }
}

/** Contador do menu do painel. Quem não é admin recebe 0, sem erro. */
export async function contarFeedbacksNovos(): Promise<number> {
  const acesso = await exigirAdmin();
  if (!acesso.ok) return 0;
  try {
    return await prisma.feedback.count({ where: { status: 'novo' } });
  } catch {
    return 0;
  }
}

export async function atualizarStatusFeedback(id: string, status: string): Promise<ResultadoEnvio> {
  const acesso = await exigirAdmin();
  if (!acesso.ok) return acesso;
  if (typeof id !== 'string' || !id || id.length > 100 || !statusValido(status)) {
    return { ok: false, error: ERRO_GENERICO };
  }

  try {
    await prisma.feedback.update({ where: { id }, data: { status } });
    revalidatePath('/admin/feedbacks');
    return { ok: true };
  } catch {
    return { ok: false, error: ERRO_GENERICO };
  }
}

export async function excluirFeedback(id: string): Promise<ResultadoEnvio> {
  const acesso = await exigirAdmin();
  if (!acesso.ok) return acesso;
  if (typeof id !== 'string' || !id || id.length > 100) return { ok: false, error: ERRO_GENERICO };

  try {
    await prisma.feedback.delete({ where: { id } });
    revalidatePath('/admin/feedbacks');
    return { ok: true };
  } catch {
    return { ok: false, error: ERRO_GENERICO };
  }
}
