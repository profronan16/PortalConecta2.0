/**
 * Proteção de edição manual no re-sync do SUAP (ROADMAP 5.5 / SPEC §14).
 *
 * Problema: `syncProjetos`/`syncEditais` fazem upsert pelo `suapId` e
 * sobrescrevem os campos de texto com o que veio do SUAP. Se um admin ajustou a
 * descrição, a área ou o coordenador no portal, o próximo sync apagava esse
 * trabalho silenciosamente.
 *
 * Como detectamos sem coluna nova: o sync grava `suapSyncedAt` no mesmo UPDATE
 * que grava os demais campos, então `updatedAt` (mantido pelo `@updatedAt` do
 * Prisma) fica praticamente igual a `suapSyncedAt`. Qualquer escrita posterior —
 * ou seja, edição humana no portal — deixa `updatedAt` mais novo que
 * `suapSyncedAt`. Essa diferença é o sinal de "editado manualmente".
 *
 * Decisão de escopo (DECISIONS.md §11): tratamento de CONFLITO saiu do escopo —
 * conflito não é cenário legítimo aqui. O que existe é só esta proteção: o sync
 * não sobrescreve, avisa no relatório e o admin pode forçar a sobrescrita.
 *
 * Esta lógica fica em módulo separado (sem Prisma) para ser testável.
 */

/**
 * Margem de tolerância. `suapSyncedAt` e `updatedAt` são gravados no mesmo
 * UPDATE, mas não no mesmo instante; 60s cobre a diferença sem esconder edições
 * humanas reais.
 */
export const TOLERANCIA_SYNC_MS = 60_000;

export type RegistroSincronizavel = {
  updatedAt: Date;
  suapSyncedAt: Date | null;
};

export type DecisaoSync = 'sobrescrever' | 'preservar';

/** O registro foi alterado no portal depois do último sync do SUAP? */
export function foiEditadoAposSync(
  registro: RegistroSincronizavel,
  toleranciaMs: number = TOLERANCIA_SYNC_MS,
): boolean {
  // Nunca sincronizado: não há edição "posterior ao sync" a proteger.
  if (!registro.suapSyncedAt) return false;

  const diferenca = registro.updatedAt.getTime() - registro.suapSyncedAt.getTime();
  return diferenca > toleranciaMs;
}

/**
 * O que fazer com o registro existente.
 * `forcar` é a válvula de escape explícita do admin (sync forçada = "o SUAP manda").
 */
export function decidirAtualizacaoSync(params: {
  editadoManualmente: boolean;
  forcar?: boolean;
}): DecisaoSync {
  if (params.editadoManualmente && !params.forcar) return 'preservar';
  return 'sobrescrever';
}

/** Mensagem padrão do relatório de sync para registros preservados. */
export function mensagemPreservado(rotulo: string, suapId: number): string {
  return `🛡️ Preservado (editado manualmente no portal após o último sync): "${rotulo}" (SUAP ID: ${suapId}) — use sync forçada para sobrescrever`;
}
