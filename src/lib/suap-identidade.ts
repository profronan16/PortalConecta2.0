/**
 * Identidade de um registro do SUAP no banco local (ROADMAP / SPEC §14 —
 * "sync é idempotente: rodar 2x não duplica").
 *
 * A API do SUAP devolve IDs de projetos de PESQUISA e de EXTENSÃO em sequências
 * separadas: o projeto 123 de pesquisa e o 123 de extensão são coisas
 * diferentes. Como o schema tem um único campo `suapId @unique`, a importação de
 * extensão usa o ID NEGATIVO — assim as duas sequências não colidem e o
 * `upsert` por `suapId` continua sendo a chave de idempotência.
 *
 * Este arquivo é puro de propósito: se essa regra quebrar, um projeto de extensão
 * sobrescreve o de pesquisa de mesmo número (ou é criado de novo a cada sync) —
 * exatamente o que o critério exige que não aconteça.
 */

export type FonteSuap = 'extensao' | 'pesquisa' | string | undefined | null;

/** ID único no nosso banco para um registro vindo do SUAP. */
export function suapIdUnico(fonte: FonteSuap, id: number): number {
  return fonte === 'extensao' ? id * -1 : id;
}

/** Dois registros de fontes diferentes com o mesmo número NÃO colidem. */
export function idsColidem(a: { fonte: FonteSuap; id: number }, b: { fonte: FonteSuap; id: number }): boolean {
  return suapIdUnico(a.fonte, a.id) === suapIdUnico(b.fonte, b.id);
}
