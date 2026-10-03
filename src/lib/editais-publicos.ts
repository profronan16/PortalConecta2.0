import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

/**
 * Regras de visibilidade PÚBLICA de editais (critério §14: "nenhum edital fica
 * público sem aprovação humana").
 *
 * Existia um furo aqui: a página de detalhe (`/editais/[slug]`) buscava o edital
 * só pelo `slug`, sem checar `review_status` nem `deleted_at`. Um edital em
 * RASCUNHO — inclusive um que a IA acabou de extrair e ninguém revisou — ficava
 * acessível para qualquer visitante que tivesse (ou adivinhasse) a URL, e o
 * `generateMetadata` ainda vazava o título dele. A listagem `/editais` já
 * filtrava corretamente; o detalhe não.
 *
 * Agora a regra fica em um lugar só, usada pela listagem, pelo detalhe e pelo
 * metadata.
 */

export const EDITAL_PUBLICO_WHERE: Prisma.EditalWhereInput = {
  review_status: 'PUBLICADO',
  deleted_at: null,
};

/**
 * Busca um edital por slug SOMENTE se ele estiver publicado e não deletado.
 *
 * `findFirst` (e não `findUnique`) porque o filtro de visibilidade não é campo
 * único; o `slug` continua sendo único, então o resultado é o mesmo.
 */
export async function buscarEditalPublicoPorSlug<T extends Prisma.EditalSelect>(
  slug: string,
  select: T,
): Promise<Prisma.EditalGetPayload<{ select: T }> | null> {
  return prisma.edital.findFirst({
    where: { slug, ...EDITAL_PUBLICO_WHERE },
    select,
  }) as Promise<Prisma.EditalGetPayload<{ select: T }> | null>;
}

/** Edital visível ao público — usado pelo metadata da página de detalhe. */
export async function buscarResumoEditalPublico(slug: string) {
  return buscarEditalPublicoPorSlug(slug, {
    titulo: true,
    resumoSimples: true,
    resumo: true,
  });
}
