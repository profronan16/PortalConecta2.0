import { validarListaDeTextos, validarTextoOpcional, validarEmail, LIMITES, type Validado } from './validacao';

/**
 * Equipe de estudantes, financiamento e vice-coordenação do projeto.
 *
 * Por que existe: a sugestão recebida pela coordenação foi que, junto ao resumo
 * do projeto, a página pública mostre quem já atua nele (bolsistas e
 * voluntários) — ver gente no projeto motiva os demais a se inscrever — e de
 * onde vem o dinheiro (IFPR, CNPq, Fundação Araucária, emenda parlamentar...).
 *
 * A EQUIPE DE ESTUDANTES NÃO É DIGITADA: é derivada das inscrições do próprio
 * projeto — quem foi SELECIONADO e ACEITOU a convocação. Assim a página pública,
 * a tela de gestão e as inscrições mostram sempre as mesmas pessoas, sem a
 * coordenação ter de manter uma segunda lista à mão.
 *
 * Financiamento e vice-coordenação são campos do projeto (não vêm do SUAP) e
 * são editados por um bloco único em todas as telas de edição.
 *
 * REGRA: quem chama a Server Action direto não passa pelo formulário, então o
 * limite é aplicado AQUI, no servidor. O `maxLength` do input é só conforto.
 */

/** Fontes de financiamento mais comuns no IFPR — botões de atalho no formulário. */
export const FINANCIAMENTOS_SUGERIDOS = [
  'IFPR',
  'CNPq',
  'Fundação Araucária',
  'Emenda Parlamentar',
] as const;

/** Tetos das listas: financiamento é um punhado de fontes (e o campo aceita "afins"). */
export const LIMITES_EQUIPE = {
  financiamento: { maxItens: 8, maxItem: 60 },
} as const;

/** Fontes de financiamento prontas para gravar. */
export function normalizarFinanciamento(valor: unknown): Validado<string[]> {
  return validarListaDeTextos(valor, 'Financiamento', LIMITES_EQUIPE.financiamento);
}

// ── Vice-coordenação ─────────────────────────────────────────────────────────

export type ViceCoordenacaoValida = {
  viceCoordenadorNome: string | null;
  viceCoordenadorEmail: string | null;
};

/**
 * Nome e e-mail do vice-coordenador prontos para gravar. O e-mail vai em
 * minúsculas porque é ele que dá acesso ao painel do projeto (comparação
 * exata em `permissions.ts`). Vazio vira `null` (projeto sem vice).
 */
export function normalizarViceCoordenacao(dados: {
  viceCoordenadorNome?: unknown;
  viceCoordenadorEmail?: unknown;
}): Validado<ViceCoordenacaoValida> {
  const nome = validarTextoOpcional(dados.viceCoordenadorNome, 'Vice-coordenador', LIMITES.linha);
  if (!nome.ok) return nome;

  const bruto = dados.viceCoordenadorEmail;
  const vazio =
    bruto === undefined || bruto === null || (typeof bruto === 'string' && bruto.trim() === '');
  const email: Validado<string | null> = vazio
    ? { ok: true, valor: null }
    : validarEmail(bruto, 'E-mail do vice-coordenador');
  if (!email.ok) return email;

  return {
    ok: true,
    valor: {
      viceCoordenadorNome: nome.valor,
      viceCoordenadorEmail: email.valor ? email.valor.toLowerCase() : null,
    },
  };
}

// ── Equipe derivada das inscrições ───────────────────────────────────────────

export type EquipeDoProjeto = {
  bolsistas: string[];
  voluntarios: string[];
  /** Bolsistas + voluntários (para o "N estudante(s)" do cartão público). */
  total: number;
};

/** Critério (Prisma `where`) das inscrições que compõem a equipe. */
export const FILTRO_INSCRICAO_NA_EQUIPE = {
  status: 'selecionado',
  resposta_aluno: 'aceito',
} as const;

export type InscricaoDaEquipe = {
  nome_completo: string;
  status: string;
  resposta_aluno: string | null;
  tipo_interesse: 'BOLSISTA' | 'VOLUNTARIO' | 'AMBOS';
  vaga?: { tipo: 'BOLSISTA' | 'VOLUNTARIO' | 'AMBOS' } | null;
};

/** A inscrição entra na equipe? Selecionada E convocação aceita. */
export function inscricaoEstaNaEquipe(inscricao: Pick<InscricaoDaEquipe, 'status' | 'resposta_aluno'>): boolean {
  return (
    inscricao.status === FILTRO_INSCRICAO_NA_EQUIPE.status &&
    inscricao.resposta_aluno === FILTRO_INSCRICAO_NA_EQUIPE.resposta_aluno
  );
}

/**
 * Papel do estudante na equipe. A vaga manda (é nela que o estudante foi
 * selecionado); sem vaga vale o que ele marcou na inscrição. Se continuar
 * "AMBOS", entra como voluntário — não há bolsa garantida para ele.
 */
function papelNaEquipe(inscricao: InscricaoDaEquipe): 'bolsista' | 'voluntario' {
  const tipoDaVaga = inscricao.vaga?.tipo;
  const tipo =
    tipoDaVaga && tipoDaVaga !== 'AMBOS' ? tipoDaVaga : inscricao.tipo_interesse;
  return tipo === 'BOLSISTA' ? 'bolsista' : 'voluntario';
}

/**
 * Separa a equipe em bolsistas e voluntários a partir das inscrições do
 * projeto, sem repetir nome e na ordem alfabética. A página pública não
 * renderiza o cartão quando `total` é 0.
 */
export function equipeDasInscricoes(inscricoes: InscricaoDaEquipe[]): EquipeDoProjeto {
  const bolsistas = new Set<string>();
  const voluntarios = new Set<string>();

  for (const inscricao of inscricoes) {
    if (!inscricaoEstaNaEquipe(inscricao)) continue;
    const nome = inscricao.nome_completo.trim();
    if (!nome) continue;
    (papelNaEquipe(inscricao) === 'bolsista' ? bolsistas : voluntarios).add(nome);
  }

  const ordenar = (nomes: Set<string>) => [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const listaBolsistas = ordenar(bolsistas);
  const listaVoluntarios = ordenar(voluntarios);
  return {
    bolsistas: listaBolsistas,
    voluntarios: listaVoluntarios,
    total: listaBolsistas.length + listaVoluntarios.length,
  };
}

function limparNomes(nomes: string[] | null | undefined): string[] {
  return (nomes ?? []).map((nome) => nome.trim()).filter(Boolean);
}

/** Fontes de financiamento exibíveis (sem vazio nem repetição). */
export function financiamentoDoProjeto(projeto: {
  financiamento?: string[] | null;
}): string[] {
  const vistos = new Set<string>();
  for (const fonte of limparNomes(projeto.financiamento)) {
    vistos.add(fonte);
  }
  return [...vistos];
}
