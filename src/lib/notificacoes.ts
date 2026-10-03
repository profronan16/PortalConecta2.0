import { prisma } from '@/lib/prisma';

/**
 * PRODUTOR de notificações internas (ROADMAP 6.2).
 *
 * Fica fora de `src/actions/notificacoes.ts` de propósito: tudo que é exportado
 * de um arquivo `'use server'` vira endpoint público — um "criar notificação
 * para qualquer usuário" seria um vetor de spam/phishing dentro do portal.
 *
 * Segue o padrão dos envios de e-mail: nunca lança. Um aviso que falha não pode
 * derrubar a ação de negócio que o disparou (mudar status de inscrição etc.).
 */

export type NovaNotificacao = {
  userId: string;
  titulo: string;
  texto?: string | null;
  link?: string | null;
};

export async function criarNotificacao(input: NovaNotificacao): Promise<boolean> {
  if (!input.userId) return false;

  try {
    await prisma.notificacao.create({
      data: {
        user_id: input.userId,
        titulo: input.titulo,
        texto: input.texto ?? null,
        link: input.link ?? null,
      },
    });
    return true;
  } catch (error) {
    console.warn('[notificacoes] falha ao criar notificação:', error);
    return false;
  }
}

/** Rótulos usados na notificação de mudança de status de inscrição. */
export const ROTULO_STATUS_INSCRICAO: Record<string, string> = {
  recebida: 'Recebida',
  em_analise: 'Em análise',
  selecionado: 'Selecionado',
  lista_espera: 'Lista de espera',
  nao_selecionado: 'Não selecionado',
  desistente: 'Desistente',
};

export function rotuloStatusInscricao(status: string): string {
  return ROTULO_STATUS_INSCRICAO[status] ?? status;
}

/**
 * Avisa o estudante (no portal) que a inscrição dele mudou de status.
 * Espelha o e-mail `enviarAtualizacaoStatus` — quem não acompanha e-mail acaba
 * sabendo pelo sino.
 */
export async function notificarMudancaStatusInscricao(input: {
  userId?: string | null;
  protocolo: string;
  projetoNome: string;
  projetoSlug?: string | null;
  novoStatus: string;
}): Promise<boolean> {
  if (!input.userId) return false;

  return criarNotificacao({
    userId: input.userId,
    titulo: `Sua inscrição em "${input.projetoNome}" foi atualizada`,
    texto: `Protocolo ${input.protocolo} — novo status: ${rotuloStatusInscricao(input.novoStatus)}.`,
    link: input.projetoSlug ? `/projetos/${input.projetoSlug}` : '/meus-dados',
  });
}
