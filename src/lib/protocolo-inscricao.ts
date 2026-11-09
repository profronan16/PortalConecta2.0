import { prisma } from '@/lib/prisma';

/**
 * Protocolo de inscrição: `PRJ-AAAA-NNNNNN`.
 *
 * O próximo número parte do MAIOR protocolo do ano, e não da contagem de
 * inscrições. Contar quebra assim que uma inscrição some (projeto excluído leva
 * as inscrições junto): com 40 gravadas e o maior em 47, "contagem + 1" gera 41,
 * que já existe, e a gravação falha com "Não conseguimos gerar o número de
 * protocolo". Os números têm largura fixa, então a ordem alfabética é a numérica.
 */

export function montarProtocolo(ano: number, numero: number): string {
  return `PRJ-${ano}-${String(numero).padStart(6, '0')}`;
}

/** Próximo protocolo do ano, dado o maior já gravado (ou `null` se não houver). */
export function protocoloSeguinte(ano: number, maiorDoAno: string | null | undefined): string {
  const atual = Number((maiorDoAno ?? '').split('-').pop());
  return montarProtocolo(ano, Number.isInteger(atual) && atual > 0 ? atual + 1 : 1);
}

export async function gerarProtocoloDaInscricao(): Promise<string> {
  const ano = new Date().getFullYear();
  const ultima = await prisma.inscricao.findFirst({
    where: { protocolo: { startsWith: `PRJ-${ano}-` } },
    orderBy: { protocolo: 'desc' },
    select: { protocolo: true },
  });
  return protocoloSeguinte(ano, ultima?.protocolo);
}

function foiConflitoDeProtocolo(e: unknown): boolean {
  const texto = e instanceof Error ? e.message : String(e);
  return (
    (texto.includes('Unique constraint') || texto.includes('duplicate key')) &&
    texto.includes('protocolo')
  );
}

/**
 * Grava com um protocolo novo e tenta de novo se duas gravações simultâneas
 * pegarem o mesmo número (o protocolo é único no banco).
 */
export async function criarComProtocolo<T>(
  criar: (protocolo: string) => Promise<T>,
  tentativas = 4,
): Promise<T> {
  let ultimoErro: unknown;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await criar(await gerarProtocoloDaInscricao());
    } catch (e) {
      if (!foiConflitoDeProtocolo(e)) throw e;
      ultimoErro = e;
    }
  }
  throw ultimoErro;
}
