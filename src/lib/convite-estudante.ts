/**
 * Regras do CONVITE de estudante feito pela coordenação do projeto.
 *
 * O convite NÃO é uma tabela nova: é uma inscrição já `selecionado`, que reaproveita
 * todo o fluxo de convocação que existe (aceite em "Meus Dados", equipe da página
 * pública, IFizinha, exportações). A diferença entre as duas formas é só a resposta:
 *
 *  - pedir confirmação  → `resposta_aluno = null`: o estudante vê o convite e aceita
 *    ou recusa (igual a uma convocação);
 *  - sem confirmação    → `resposta_aluno = 'aceito'`: entra direto na equipe.
 *
 * Fica aqui (puro, sem Prisma) pelo mesmo motivo de `inscricao-aluno.ts`: a regra
 * decide o que a Server Action grava e é travada por teste.
 */

export type TipoDoConvite = 'BOLSISTA' | 'VOLUNTARIO';

export const TIPOS_DE_CONVITE: readonly TipoDoConvite[] = ['BOLSISTA', 'VOLUNTARIO'];

export function ehTipoDeConvite(valor: unknown): valor is TipoDoConvite {
  return valor === 'BOLSISTA' || valor === 'VOLUNTARIO';
}

export const ROTULO_TIPO_DO_CONVITE: Record<TipoDoConvite, string> = {
  BOLSISTA: 'Bolsista',
  VOLUNTARIO: 'Voluntário',
};

/** Mínimo de letras para buscar estudante (evita listar a base inteira com "a"). */
export const MINIMO_DA_BUSCA = 3;
export const MAXIMO_DE_RESULTADOS = 8;

/** Texto da busca pronto para usar; `null` quando é curto demais. */
export function termoDeBuscaValido(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const termo = valor.trim().replace(/\s+/g, ' ').slice(0, 80);
  return termo.length >= MINIMO_DA_BUSCA ? termo : null;
}

export type InscricaoExistente = {
  status: string;
  resposta_aluno: string | null;
};

export type DecisaoDoConvite =
  | { acao: 'criar'; respostaAluno: 'aceito' | null }
  | { acao: 'atualizar'; respostaAluno: 'aceito' | null }
  | { acao: 'recusar'; motivo: 'ja_na_equipe' | 'ja_convidado' };

/**
 * O que fazer ao convidar, dada a inscrição que o estudante já tem no projeto
 * (se tiver).
 *
 *  - já na equipe (selecionado + aceito): nada a fazer;
 *  - já convidado e esperando resposta: repetir o pedido de confirmação seria
 *    duplicar o aviso — mas aceitar direto converte o convite pendente;
 *  - qualquer outro estado (recebida, lista de espera, desistente, recusada...):
 *    a coordenação está reconvocando, então a inscrição existente é reaproveitada.
 */
export function decidirConvite(
  existente: InscricaoExistente | null,
  pedirConfirmacao: boolean,
): DecisaoDoConvite {
  const respostaAluno = pedirConfirmacao ? null : 'aceito';
  if (!existente) return { acao: 'criar', respostaAluno };

  if (existente.status === 'selecionado') {
    if (existente.resposta_aluno === 'aceito') return { acao: 'recusar', motivo: 'ja_na_equipe' };
    if (!existente.resposta_aluno && pedirConfirmacao) {
      return { acao: 'recusar', motivo: 'ja_convidado' };
    }
  }
  return { acao: 'atualizar', respostaAluno };
}

/**
 * Ao reaproveitar uma inscrição que já está numa vaga, a vaga manda no papel
 * exibido na equipe (`papelNaEquipe`). Se a coordenação escolheu um papel
 * diferente do da vaga, a ligação com a vaga sai — senão o convite de
 * "Voluntário" apareceria como "Bolsista".
 */
export function vagaCombinaComOPapel(
  tipoDaVaga: 'BOLSISTA' | 'VOLUNTARIO' | 'AMBOS',
  tipo: TipoDoConvite,
): boolean {
  return tipoDaVaga === 'AMBOS' || tipoDaVaga === tipo;
}

/** Linha da observação interna que registra o convite (o coordenador a lê na inscrição). */
export function observacaoDoConvite(input: {
  pedirConfirmacao: boolean;
  tipo: TipoDoConvite;
  por: string;
  dataBr: string;
}): string {
  const como = input.pedirConfirmacao
    ? 'aguardando confirmação do estudante'
    : 'adicionado direto à equipe, sem pedir confirmação';
  return `Convite da coordenação (${ROTULO_TIPO_DO_CONVITE[input.tipo]}) em ${input.dataBr} por ${input.por}: ${como}.`;
}

/** Junta a observação nova à que já existia, sem apagar o histórico. */
export function acrescentarObservacao(atual: string | null | undefined, nova: string): string {
  const antes = (atual ?? '').trim();
  return antes ? `${antes}\n${nova}` : nova;
}

// ── Cancelar convite / remover da equipe ─────────────────────────────────────

export type InscricaoParaRemover = {
  resposta_aluno: string | null;
  observacao_interna: string | null;
  justificativa: string | null;
  ciencia_regras: boolean;
  consentimento_lgpd: boolean;
};

const INICIO_DA_OBSERVACAO_DO_CONVITE = 'Convite da coordenação';

/**
 * A inscrição existe SÓ por causa do convite (o estudante nunca se inscreveu):
 * a única anotação é a do convite e não há formulário preenchido. Nesse caso
 * cancelar o convite apaga o registro, sem deixar uma inscrição fantasma.
 */
export function ehConviteSemHistorico(i: InscricaoParaRemover): boolean {
  const obs = (i.observacao_interna ?? '').trim();
  return (
    obs.startsWith(INICIO_DA_OBSERVACAO_DO_CONVITE) &&
    !obs.includes('\n') &&
    !i.justificativa &&
    !i.ciencia_regras &&
    !i.consentimento_lgpd
  );
}

export type DestinoAoRemover =
  | { acao: 'excluir' }
  | { acao: 'mudar_status'; status: 'em_analise' | 'nao_selecionado' };

/**
 * O que acontece com a inscrição ao cancelar o convite ou tirar da equipe.
 *  - só existia por causa do convite → apaga;
 *  - o estudante tinha se inscrito: convite pendente volta a "em análise";
 *    quem já estava na equipe vira "não selecionado" (decisão da coordenação,
 *    diferente de "desistente", que é do estudante).
 */
export function destinoAoRemoverDaEquipe(i: InscricaoParaRemover): DestinoAoRemover {
  if (ehConviteSemHistorico(i)) return { acao: 'excluir' };
  return {
    acao: 'mudar_status',
    status: i.resposta_aluno === 'aceito' ? 'nao_selecionado' : 'em_analise',
  };
}
