// Perguntas extras que o coordenador de um projeto (ou o Admin) pode
// adicionar ao formulário público de inscrição, além dos campos padrão
// (nome, e-mail, curso etc.). Persistidas em `Projeto.formulario_extra`
// (Json) e as respostas em `Inscricao.campos_extra` (Json, chaveado pelo
// `id` da pergunta).

export type TipoPerguntaExtra =
  | 'texto_curto'
  | 'texto_longo'
  | 'unica_escolha'
  | 'multipla_escolha'
  | 'declaracao';

export type PerguntaExtra = {
  id: string;
  tipo: TipoPerguntaExtra;
  pergunta: string;
  opcoes?: string[];
  obrigatoria: boolean;
};

export const TIPOS_PERGUNTA_EXTRA: { value: TipoPerguntaExtra; label: string }[] = [
  { value: 'texto_curto', label: 'Texto curto' },
  { value: 'texto_longo', label: 'Texto longo (parágrafo)' },
  { value: 'unica_escolha', label: 'Múltipla escolha (uma resposta)' },
  { value: 'multipla_escolha', label: 'Caixas de seleção (várias respostas)' },
  { value: 'declaracao', label: 'Declaração (checkbox único, ex: "Declaro que...")' },
];

export function novoIdPerguntaExtra(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Valida e normaliza o Json vindo do banco — nunca confia na forma sem checar. */
export function parsePerguntasExtra(raw: unknown): PerguntaExtra[] {
  if (!Array.isArray(raw)) return [];
  const tipos = new Set(TIPOS_PERGUNTA_EXTRA.map((t) => t.value));
  return raw.filter((p): p is PerguntaExtra =>
    !!p &&
    typeof p === 'object' &&
    typeof (p as PerguntaExtra).id === 'string' &&
    typeof (p as PerguntaExtra).pergunta === 'string' &&
    tipos.has((p as PerguntaExtra).tipo)
  );
}

/** Nome do campo no `<form>` público de inscrição para uma pergunta extra. */
export function nomeCampoExtra(perguntaId: string): string {
  return `extra_${perguntaId}`;
}

/**
 * Lê as respostas de uma FormData (formulário público de inscrição) de
 * acordo com as perguntas configuradas pelo coordenador, retornando um
 * objeto pronto pra salvar em `Inscricao.campos_extra`.
 */
export function coletarRespostasExtra(form: FormData, perguntas: PerguntaExtra[]): Record<string, string | string[] | boolean> {
  const respostas: Record<string, string | string[] | boolean> = {};
  for (const p of perguntas) {
    const campo = nomeCampoExtra(p.id);
    if (p.tipo === 'declaracao') {
      respostas[p.id] = form.get(campo) === 'on';
    } else if (p.tipo === 'multipla_escolha') {
      const valores = form.getAll(campo).map(String).filter(Boolean);
      if (valores.length > 0) respostas[p.id] = valores;
    } else {
      const valor = form.get(campo);
      if (typeof valor === 'string' && valor.trim()) respostas[p.id] = valor.trim();
    }
  }
  return respostas;
}

/** Verifica se todas as perguntas obrigatórias foram respondidas — usado como segunda checagem no servidor. */
export function validarRespostasExtraObrigatorias(
  perguntas: PerguntaExtra[],
  respostas: Record<string, unknown>
): string | null {
  for (const p of perguntas) {
    if (!p.obrigatoria) continue;
    const resposta = respostas[p.id];
    const vazio =
      resposta === undefined ||
      resposta === null ||
      resposta === false ||
      (typeof resposta === 'string' && resposta.trim() === '') ||
      (Array.isArray(resposta) && resposta.length === 0);
    if (vazio) return `A pergunta "${p.pergunta}" é obrigatória.`;
  }
  return null;
}

/** Junta pergunta + resposta em pares legíveis, para exibir no painel do admin/professor. */
export function resolverRespostasExtra(
  perguntas: PerguntaExtra[],
  respostas: unknown
): { pergunta: string; resposta: string }[] {
  if (!respostas || typeof respostas !== 'object') return [];
  const mapa = respostas as Record<string, unknown>;
  return perguntas
    .map((p) => {
      const valor = mapa[p.id];
      if (valor === undefined || valor === null || valor === '') return null;
      const resposta =
        typeof valor === 'boolean' ? (valor ? 'Sim' : 'Não') :
        Array.isArray(valor) ? valor.join(', ') :
        String(valor);
      if (!resposta) return null;
      return { pergunta: p.pergunta, resposta };
    })
    .filter((x): x is { pergunta: string; resposta: string } => x !== null);
}
