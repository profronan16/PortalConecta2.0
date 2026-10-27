'use server';

import { prisma } from '@/lib/prisma';
import { translatePrismaError } from '@/lib/utils';
import { resolverUsuarioDaSessao } from '@/lib/usuario-sessao';
import { notificarCoordenadoresDoProjeto } from '@/lib/notificacoes';
import { formatarDataBrasil } from '@/lib/datas';
import { sincronizarProjetoSintetico } from '@/lib/projeto-sintetico';
import type { Prisma } from '@prisma/client';
import {
  ehRespostaConvocacao,
  podeDesistir,
  podeResponderConvocacao,
  rotuloRespostaAluno,
  type RespostaConvocacao,
} from '@/lib/inscricao-aluno';

/**
 * Ações do ESTUDANTE sobre a própria inscrição — o outro lado de
 * `updateInscricaoStatus` (src/actions/professor.ts), que é a decisão do
 * coordenador.
 *
 * Duas regras valem em toda função daqui e NÃO podem regredir:
 *
 *  1. POSSE: a inscrição tem que ser do usuário da sessão. O `user_id` pode ser
 *     nulo (inscrição antiga, feita deslogado, só com o e-mail), por isso a
 *     checagem aceita as duas chaves — mas nunca aceita "qualquer inscrição".
 *     Confiar no `inscricaoId` que o cliente mandou, sem isso, deixaria qualquer
 *     pessoa desistir da vaga de outra (mesmo raciocínio dos achados S3/S18/S20
 *     do RELATORIO_TESTES.md).
 *  2. TRANSIÇÃO: só as transições que fazem sentido (ver src/lib/inscricao-aluno.ts).
 *     O servidor nunca confia que o botão certo foi o único clicável.
 */

export type ResultadoInscricao =
  | { ok: true; status: string; respostaAluno: RespostaConvocacao | null }
  | { ok: false; error: string };

type InscricaoDoAluno = {
  id: string;
  protocolo: string;
  status: string;
  resposta_aluno: string | null;
  user_id: string | null;
  email: string;
  nome_completo: string;
  projeto_id: string;
};

function ehDonoDaInscricao(
  inscricao: InscricaoDoAluno,
  sessao: { userId: string; email: string },
): boolean {
  if (inscricao.user_id && inscricao.user_id === sessao.userId) return true;
  // Inscrição feita sem login não tem `user_id` — o e-mail gravado no formulário
  // é a única chave. A comparação é a MESMA que "Meus Dados" usa para LISTAR as
  // inscrições (`whereInscricoesDoUsuario`): se aqui fosse mais restrita, a
  // pessoa veria a inscrição na tela e levaria "não é sua" ao tentar agir nela.
  // E-mail não diferencia maiúsculas; o e-mail da sessão vem verificado do
  // Firebase, então isto não é um valor que o cliente escolhe.
  return (inscricao.email ?? '').toLowerCase() === sessao.email.toLowerCase();
}

async function buscarInscricaoDoAluno(
  idToken: string,
  inscricaoId: string,
): Promise<
  | { ok: true; inscricao: InscricaoDoAluno; sessao: { userId: string; email: string }; projetoNome: string }
  | { ok: false; error: string }
> {
  const sessao = await resolverUsuarioDaSessao(idToken);
  if (!sessao.ok) return { ok: false, error: sessao.error };

  const inscricao = await prisma.inscricao.findUnique({
    where: { id: inscricaoId },
    select: {
      id: true,
      protocolo: true,
      status: true,
      resposta_aluno: true,
      user_id: true,
      email: true,
      nome_completo: true,
      projeto_id: true,
      projeto: { select: { nome: true } },
    },
  });

  // Mesma mensagem para "não existe" e "não é sua": a resposta não deve revelar
  // se um id qualquer existe no banco.
  if (!inscricao || !ehDonoDaInscricao(inscricao, sessao)) {
    return { ok: false, error: 'Não encontramos esta inscrição na sua conta.' };
  }

  return {
    ok: true,
    inscricao,
    sessao: { userId: sessao.userId, email: sessao.email },
    projetoNome: inscricao.projeto.nome,
  };
}

function respostaDe(valor: string | null): RespostaConvocacao | null {
  return ehRespostaConvocacao(valor) ? valor : null;
}

async function registrarAuditoria(input: {
  userId: string;
  acao: string;
  inscricaoId: string;
  detalhes: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        user_id: input.userId,
        acao: input.acao,
        entidade: 'inscricao',
        entidade_id: input.inscricaoId,
        detalhes: input.detalhes as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    // Auditoria que falha não pode desfazer a ação do estudante (mesmo padrão
    // dos e-mails e notificações).
    console.warn('[minhas-inscricoes] falha ao registrar auditoria:', e);
  }
}

/**
 * Estudante desiste da própria inscrição.
 *
 * O status vira `desistente` (valor que já existe e já é tratado nos filtros,
 * relatórios e e-mails) e o motivo — quando informado — vai para
 * `observacao_interna`, que é o campo que o coordenador lê no painel dele.
 * A inscrição NUNCA é apagada: vaga liberada não pode apagar histórico.
 */
export async function desistirDaInscricao(
  idToken: string,
  inscricaoId: string,
  motivo?: string,
): Promise<ResultadoInscricao> {
  try {
    const busca = await buscarInscricaoDoAluno(idToken, inscricaoId);
    if (!busca.ok) return busca;

    const { inscricao, sessao, projetoNome } = busca;

    if (!podeDesistir(inscricao.status)) {
      return {
        ok: false,
        error:
          inscricao.status === 'desistente'
            ? 'Você já desistiu desta inscrição.'
            : 'Esta inscrição já foi encerrada como "não selecionado" — não há mais nada para cancelar.',
      };
    }

    const motivoLimpo = motivo?.trim().slice(0, 500) || null;
    const agora = new Date();

    await prisma.inscricao.update({
      where: { id: inscricao.id },
      data: {
        status: 'desistente',
        desistiu_em: agora,
        ...(motivoLimpo ? { observacao_interna: `Desistiu pelo portal em ${formatarDataBrasil(agora, { day: '2-digit', month: '2-digit', year: 'numeric' })}. Motivo: ${motivoLimpo}` } : {}),
      },
    });

    // Quem desiste sai da equipe da página pública.
    void sincronizarProjetoSintetico(inscricao.projeto_id).catch(console.error);

    await registrarAuditoria({
      userId: sessao.userId,
      acao: 'desistencia_inscricao',
      inscricaoId: inscricao.id,
      detalhes: {
        protocolo: inscricao.protocolo,
        projeto: projetoNome,
        status_anterior: inscricao.status,
        motivo: motivoLimpo,
      },
    });

    await notificarCoordenadoresDoProjeto({
      projetoId: inscricao.projeto_id,
      titulo: `Desistência em "${projetoNome}"`,
      texto: `${inscricao.nome_completo} (${inscricao.protocolo}) desistiu da inscrição pelo portal.${motivoLimpo ? ` Motivo: ${motivoLimpo}` : ''}`,
      link: `/professor/projetos/${inscricao.projeto_id}`,
    });

    return { ok: true, status: 'desistente', respostaAluno: respostaDe(inscricao.resposta_aluno) };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

/**
 * Estudante responde a uma convocação (status `selecionado`).
 *
 * ACEITAR mantém o status `selecionado` — a pessoa é de fato a selecionada, e é
 * esse status que as contagens de vaga e os relatórios já usam.
 *
 * RECUSAR derruba o status para `desistente`, porque a vaga precisa voltar a
 * contar como livre; `resposta_aluno = 'recusado'` é o que preserva a diferença
 * entre "recusou o convite" e "desistiu depois de aceitar".
 *
 * A resposta é definitiva pelo portal: quem clicou errado fala com a coordenação
 * (que pode mudar o status pelo painel). Permitir trocar aqui faria o
 * coordenador agir em cima de uma resposta que já mudou.
 */
export async function responderConvocacao(
  idToken: string,
  inscricaoId: string,
  resposta: RespostaConvocacao,
): Promise<ResultadoInscricao> {
  try {
    if (!ehRespostaConvocacao(resposta)) {
      return { ok: false, error: 'Resposta inválida para a convocação.' };
    }

    const busca = await buscarInscricaoDoAluno(idToken, inscricaoId);
    if (!busca.ok) return busca;

    const { inscricao, sessao, projetoNome } = busca;

    if (!podeResponderConvocacao(inscricao.status, inscricao.resposta_aluno)) {
      if (inscricao.resposta_aluno) {
        return {
          ok: false,
          error: `Você já respondeu a esta convocação (${rotuloRespostaAluno(inscricao.resposta_aluno)}). Se precisar mudar, fale com a coordenação do projeto.`,
        };
      }
      return {
        ok: false,
        error: 'Esta inscrição não está aguardando resposta de convocação.',
      };
    }

    const agora = new Date();
    const novoStatus = resposta === 'aceito' ? inscricao.status : 'desistente';

    await prisma.inscricao.update({
      where: { id: inscricao.id },
      data: {
        resposta_aluno: resposta,
        respondido_em: agora,
        ...(resposta === 'recusado' ? { status: 'desistente', desistiu_em: agora } : {}),
      },
    });

    // Aceitar a convocação é o que coloca o estudante na equipe da página
    // pública; a base da IFizinha acompanha (não bloqueia a resposta).
    void sincronizarProjetoSintetico(inscricao.projeto_id).catch(console.error);

    await registrarAuditoria({
      userId: sessao.userId,
      acao: resposta === 'aceito' ? 'convocacao_aceita' : 'convocacao_recusada',
      inscricaoId: inscricao.id,
      detalhes: { protocolo: inscricao.protocolo, projeto: projetoNome },
    });

    await notificarCoordenadoresDoProjeto({
      projetoId: inscricao.projeto_id,
      titulo:
        resposta === 'aceito'
          ? `Convocação aceita em "${projetoNome}"`
          : `Convocação recusada em "${projetoNome}"`,
      texto:
        resposta === 'aceito'
          ? `${inscricao.nome_completo} (${inscricao.protocolo}) aceitou a convocação.`
          : `${inscricao.nome_completo} (${inscricao.protocolo}) recusou a convocação — a vaga volta a ficar disponível.`,
      link: `/professor/projetos/${inscricao.projeto_id}`,
    });

    return { ok: true, status: novoStatus, respostaAluno: resposta };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}
