import type { Prisma } from '@prisma/client';

/**
 * Edição controlada de projetos (ROADMAP 2.10 / SPEC §14 — "edita campos
 * controlados").
 *
 * Regra: em projetos que vêm do SUAP, os campos INSTITUCIONAIS são somente
 * leitura no portal — quem manda neles é o SUAP (nome, coordenador, área e
 * situação). O professor continua dono da APRESENTAÇÃO do projeto: descrição,
 * cor, contatos, links e formulário de inscrição.
 *
 * A checagem vive aqui (módulo puro, testável) e é aplicada no SERVIDOR em
 * `updateMyProjeto` — desabilitar o input na tela é conveniência, não segurança.
 */

export const CAMPOS_CONTROLADOS_PELO_SUAP = ['nome', 'coordenador', 'area', 'status'] as const;

export type CampoControladoPeloSuap = (typeof CAMPOS_CONTROLADOS_PELO_SUAP)[number];

/** Campos que o professor pode editar em qualquer projeto. */
export const CAMPOS_LIVRES_DO_PROFESSOR = [
  'descricao',
  'corPrimaria',
  'logoUrl',
  'bannerUrl',
  'email',
  'instagram',
  'site',
  // Financiamento e vice-coordenação exibidos na página pública. São campos
  // do portal (não institucionais): o professor continua dono deles mesmo em
  // projeto importado do SUAP. A equipe de estudantes não entra aqui: vem das
  // inscrições (ver src/lib/projetos-equipe.ts).
  'financiamento',
  'viceCoordenadorNome',
  'viceCoordenadorEmail',
  'formularioExtra',
] as const;

export type ProjetoOrigem = {
  suapId?: number | null;
  source?: string | null;
};

/** O projeto foi importado do SUAP? */
export function projetoVemDoSuap(projeto: ProjetoOrigem): boolean {
  if (projeto.suapId !== null && projeto.suapId !== undefined) return true;
  return projeto.source === 'SUAP';
}

/** Campos que NÃO podem ser editados neste projeto. */
export function camposBloqueadosParaEdicao(projeto: ProjetoOrigem): CampoControladoPeloSuap[] {
  return projetoVemDoSuap(projeto) ? [...CAMPOS_CONTROLADOS_PELO_SUAP] : [];
}

/**
 * Separa o que veio do formulário entre permitido e ignorado.
 * Campos ausentes (`undefined`) não entram em nenhuma das listas — não foram
 * enviados, então não há o que bloquear.
 */
export function filtrarEdicaoProjeto<T extends Record<string, unknown>>(
  dados: T,
  bloqueados: readonly string[],
): { permitido: Partial<T>; ignorados: string[] } {
  const permitido: Record<string, unknown> = {};
  const ignorados: string[] = [];

  for (const [campo, valor] of Object.entries(dados)) {
    if (valor === undefined) continue;

    if (bloqueados.includes(campo)) {
      // Só reporta como "tentativa bloqueada" se realmente mudou algo.
      ignorados.push(campo);
      continue;
    }

    permitido[campo] = valor;
  }

  return { permitido: permitido as Partial<T>, ignorados };
}

/** Texto exibido na tela e no retorno da Server Action. */
export const AVISO_CAMPOS_SUAP =
  'Nome, coordenador, área e situação vêm do SUAP e são somente leitura aqui. ' +
  'Para alterá-los, atualize o projeto no SUAP.';

/** Nomes amigáveis para a mensagem de retorno. */
export const ROTULO_CAMPO: Record<CampoControladoPeloSuap, string> = {
  nome: 'Nome',
  coordenador: 'Coordenador',
  area: 'Área',
  status: 'Situação',
};

export function descreverCamposIgnorados(campos: string[]): string {
  return campos
    .map((c) => ROTULO_CAMPO[c as CampoControladoPeloSuap] ?? c)
    .join(', ');
}

/**
 * O slug (URL pública do projeto) deve ser regerado nesta edição?
 *
 * Regra: SÓ quando o nome muda de verdade. O slug é o endereço que o professor
 * compartilha com os estudantes (e o que o botão "Ver no portal" abre), então
 * salvar uma cor, a descrição ou o formulário de inscrição não pode trocar a URL
 * por baixo. Foi o que aconteceu com o projeto "Robótica e Automação no Ensino
 * Médio": o slug era `demo-robotica-demo` (do dado de demonstração) e qualquer
 * salvamento o reescreveu para `robotica-e-automacao-no-ensino-medio`, deixando
 * links já divulgados apontando para lugar nenhum.
 */
export function deveRegenerarSlugDoProjeto(nomeAtual: string, nomeNovo: string): boolean {
  return nomeNovo.trim() !== nomeAtual.trim();
}

/** Trecho de update do Prisma com apenas os campos permitidos. */
export type DadosEdicaoProfessor = {
  nome?: string;
  coordenador?: string;
  area?: string;
  status?: string;
  descricao?: string | null;
  resumoCurto?: string | null;
  corPrimaria?: string;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  email?: string | null;
  instagram?: string | null;
  site?: string | null;
  // Financiamento e vice-coordenação: campos do projeto (não vêm do SUAP), por
  // isso o professor sempre pode editá-los — ver src/lib/projetos-equipe.ts.
  financiamento?: string[];
  viceCoordenadorNome?: string | null;
  viceCoordenadorEmail?: string | null;
  formularioExtra?: unknown;
};

export type ResultadoFiltroEdicao = {
  dados: Prisma.ProjetoUpdateInput;
  ignorados: string[];
};
