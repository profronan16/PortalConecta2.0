import { prisma } from '@/lib/prisma';
import {
  equipeDasInscricoes,
  FILTRO_INSCRICAO_NA_EQUIPE,
  type EquipeDoProjeto,
} from '@/lib/projetos-equipe';

/**
 * Equipe de estudantes de um projeto, lida das inscrições (selecionado + aceitou
 * a convocação). Fonte única da página pública, do painel e da IFizinha.
 * Só leitura — quem chama decide quem pode ver (ver `getEquipeDoProjeto`).
 */
export async function buscarEquipeDoProjeto(projetoId: string): Promise<EquipeDoProjeto> {
  const inscricoes = await prisma.inscricao.findMany({
    where: { projeto_id: projetoId, ...FILTRO_INSCRICAO_NA_EQUIPE },
    select: {
      nome_completo: true,
      status: true,
      resposta_aluno: true,
      tipo_interesse: true,
      vaga: { select: { tipo: true } },
    },
  });
  return equipeDasInscricoes(inscricoes);
}
