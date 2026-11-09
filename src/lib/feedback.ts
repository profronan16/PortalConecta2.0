/**
 * Regras do feedback dos visitantes (página /feedback → caixa de entrada do
 * Administrador Geral em /admin/feedbacks). Funções puras, sem banco, para
 * poderem ser usadas no cliente e testadas.
 */

export const TIPOS_FEEDBACK = [
  { valor: 'sugestao', rotulo: 'Sugestão', ajuda: 'Uma ideia para melhorar o portal' },
  { valor: 'problema', rotulo: 'Problema no site', ajuda: 'Algo não funciona ou está errado' },
  { valor: 'duvida', rotulo: 'Dúvida', ajuda: 'Não encontrei o que procurava' },
  { valor: 'elogio', rotulo: 'Elogio', ajuda: 'Algo que funcionou bem' },
  { valor: 'outro', rotulo: 'Outro assunto', ajuda: 'Qualquer outra mensagem' },
] as const;

export type TipoFeedback = (typeof TIPOS_FEEDBACK)[number]['valor'];

export const STATUS_FEEDBACK = ['novo', 'lido', 'resolvido'] as const;
export type StatusFeedback = (typeof STATUS_FEEDBACK)[number];

export const ROTULO_STATUS_FEEDBACK: Record<StatusFeedback, string> = {
  novo: 'Novo',
  lido: 'Lido',
  resolvido: 'Resolvido',
};

export const MENSAGEM_MIN = 10;
export const MENSAGEM_MAX = 2000;
export const CONTATO_MAX = 120;
const PAGINA_MAX = 200;

export function rotuloDoTipo(tipo: string): string {
  return TIPOS_FEEDBACK.find((t) => t.valor === tipo)?.rotulo ?? 'Outro assunto';
}

export function tipoValido(tipo: unknown): tipo is TipoFeedback {
  return typeof tipo === 'string' && TIPOS_FEEDBACK.some((t) => t.valor === tipo);
}

export function statusValido(status: unknown): status is StatusFeedback {
  return typeof status === 'string' && (STATUS_FEEDBACK as readonly string[]).includes(status);
}

export type FeedbackEntrada = {
  tipo?: unknown;
  mensagem?: unknown;
  contato?: unknown;
  pagina?: unknown;
  /** Campo-isca: invisível para pessoas, preenchido por robôs. */
  website?: unknown;
};

export type FeedbackValidado = {
  tipo: TipoFeedback;
  mensagem: string;
  contato: string | null;
  pagina: string | null;
};

export type ResultadoValidacao =
  | { ok: true; dados: FeedbackValidado }
  | { ok: false; error: string }
  /** Robô: finge sucesso, sem gravar nada. */
  | { ok: 'descartado' };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Só o caminho (sem domínio nem query string, que pode carregar dados pessoais). */
export function caminhoDaPagina(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const semQuery = valor.trim().split(/[?#]/)[0];
  if (!semQuery.startsWith('/') || semQuery.startsWith('//')) return null;
  return semQuery.slice(0, PAGINA_MAX);
}

export function validarFeedback(entrada: FeedbackEntrada): ResultadoValidacao {
  if (typeof entrada.website === 'string' && entrada.website.trim() !== '') {
    return { ok: 'descartado' };
  }

  if (!tipoValido(entrada.tipo)) {
    return { ok: false, error: 'Escolha o tipo da mensagem.' };
  }

  // Remove caracteres de controle e espaços repetidos nas pontas; preserva as quebras de linha.
  const mensagem = (typeof entrada.mensagem === 'string' ? entrada.mensagem : '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (mensagem.length < MENSAGEM_MIN) {
    return { ok: false, error: `Escreva um pouco mais (pelo menos ${MENSAGEM_MIN} caracteres) para conseguirmos entender.` };
  }
  if (mensagem.length > MENSAGEM_MAX) {
    return { ok: false, error: `A mensagem passou de ${MENSAGEM_MAX} caracteres. Resuma um pouco e envie de novo.` };
  }

  const contatoBruto = typeof entrada.contato === 'string' ? entrada.contato.trim() : '';
  if (contatoBruto && (contatoBruto.length > CONTATO_MAX || !EMAIL.test(contatoBruto))) {
    return { ok: false, error: 'Confira o e-mail de contato ou deixe o campo em branco.' };
  }

  return {
    ok: true,
    dados: {
      tipo: entrada.tipo,
      mensagem,
      contato: contatoBruto ? contatoBruto.toLowerCase() : null,
      pagina: caminhoDaPagina(entrada.pagina),
    },
  };
}

/** Prévia curta para o aviso no sino. */
export function previaDaMensagem(mensagem: string, limite = 120): string {
  const linha = mensagem.replace(/\s+/g, ' ').trim();
  return linha.length > limite ? `${linha.slice(0, limite - 1)}…` : linha;
}
