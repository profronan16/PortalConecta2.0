'use server';

import { prisma } from '@/lib/prisma';
import { slugify, translatePrismaError } from '@/lib/utils';
import { enviarAtualizacaoStatus } from '@/lib/email';
import { cache } from '@/lib/cache';
import { sincronizarProjetoSintetico } from '@/lib/projeto-sintetico';
import { sanitizeHtml } from '@/lib/rich-text';
import type { PerguntaExtra } from '@/lib/formulario-extra';
import { isAdministradorGeral, projetosAcessiveis, temAcessoAoProjeto, whereUsuarioTemAcessoAoProjeto } from '@/lib/permissions';
import type { Prisma } from '@prisma/client';

type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

export type MyProjetoFormData = {
  nome: string;
  coordenador: string;
  area: string;
  descricao?: string;
  status: string;
  corPrimaria: string;
  email?: string;
  instagram?: string;
  site?: string;
  formularioExtra?: PerguntaExtra[];
};

export async function getProfessorStats(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { totalProjetos: 0, projetosAtivos: 0, totalInscritos: 0, inscricoesPendentes: 0 };

  const projetos = await prisma.projeto.findMany({
    where: isAdministradorGeral(email) ? {} : whereUsuarioTemAcessoAoProjeto(email),
    select: { id: true },
  });

  const projetoIds = projetos.map((p) => p.id);

  const [projetosAtivos, totalInscritos, inscricoesPendentes] = await Promise.all([
    prisma.projeto.count({
      where: {
        id: { in: projetoIds },
        status: { in: ['ATIVO', 'EM_EXECUCAO', 'INSCRICOES_ABERTAS'] },
      },
    }),
    prisma.inscricao.count({
      where: { projeto_id: { in: projetoIds } },
    }),
    prisma.inscricao.count({
      where: {
        projeto_id: { in: projetoIds },
        status: 'recebida',
      },
    }),
  ]);

  return {
    totalProjetos: projetos.length,
    projetosAtivos,
    totalInscritos,
    inscricoesPendentes,
  };
}

export async function listMyProjetos(email: string) {
  return projetosAcessiveis(email);
}

export async function getProjetoDetalhes(projetoId: string, userEmail: string) {
  if (!(await temAcessoAoProjeto(projetoId, userEmail))) return null;

  return prisma.projeto.findUnique({
    where: { id: projetoId },
    include: {
      coordenadores: { include: { user: { select: { id: true, name: true, email: true } } } },
      admins: { select: { id: true, name: true, email: true } },
      faq: { orderBy: { ordem: 'asc' } },
      tags: true,
      cursos: true,
      _count: { select: { inscricoes: true } },
    },
  });
}

export async function listInscricoes(projetoId: string, userEmail: string) {
  if (!(await temAcessoAoProjeto(projetoId, userEmail))) {
    return { ok: false, error: 'Acesso negado' } as const;
  }

  const inscricoes = await prisma.inscricao.findMany({
    where: { projeto_id: projetoId },
    orderBy: { created_at: 'desc' },
  });

  return { ok: true, data: inscricoes } as const;
}

/**
 * Atualiza um projeto (apenas o coordenador/admin pode)
 */
export async function updateMyProjeto(projetoId: string, data: MyProjetoFormData, userEmail?: string): Promise<ActionResult> {
  try {
    // `userEmail` sempre checado — nunca opcional. Ver mesmo raciocínio em
    // updateInscricaoStatus: torná-lo opcional permitia pular a checagem só
    // omitindo o parâmetro numa chamada direta à Server Action.
    if (!userEmail) return { ok: false, error: 'Não autenticado' };
    if (!(await temAcessoAoProjeto(projetoId, userEmail))) {
      return { ok: false, error: 'Acesso negado: você não é coordenador deste projeto' };
    }

    await prisma.projeto.update({
      where: { id: projetoId },
      data: {
        nome: data.nome,
        slug: slugify(data.nome),
        coordenador: data.coordenador,
        area: data.area,
        descricao: data.descricao || null,
        status: data.status as any,
        corPrimaria: data.corPrimaria,
        email: data.email || null,
        instagram: data.instagram || null,
        site: data.site || null,
        ...(data.formularioExtra !== undefined ? { formulario_extra: data.formularioExtra } : {}),
      },
    });
    cache.invalidate('chat:');
    await sincronizarProjetoSintetico(projetoId).catch(console.error);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

/**
 * Abre as inscrições com prazo definido — diferente de `toggleInscricoes`
 * (que só alterna o estado atual), esta sempre define `inscricao_fim`
 * explicitamente. Sem isso, não existia em lugar nenhum do painel uma
 * forma de definir o prazo final de inscrição: o campo existe no banco e
 * é checado em `verificarInscricoesAbertas`, mas ficava sempre `null`.
 */
export async function abrirInscricoes(
  projetoId: string,
  userEmail: string,
  data: { inscricaoInicio?: string; inscricaoFim: string }
): Promise<ActionResult<{ inscricoes_abertas: boolean }>> {
  try {
    if (!(await temAcessoAoProjeto(projetoId, userEmail))) return { ok: false, error: 'Acesso negado' };
    if (!data.inscricaoFim) return { ok: false, error: 'Informe o prazo final das inscrições' };

    await prisma.projeto.update({
      where: { id: projetoId },
      data: {
        inscricoes_abertas: true,
        status: 'INSCRICOES_ABERTAS',
        inscricao_inicio: data.inscricaoInicio ? new Date(data.inscricaoInicio) : new Date(),
        inscricao_fim: new Date(data.inscricaoFim),
      },
    });
    await sincronizarProjetoSintetico(projetoId).catch(console.error);

    return { ok: true, data: { inscricoes_abertas: true } };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

export async function toggleInscricoes(projetoId: string, userEmail: string): Promise<ActionResult<{ inscricoes_abertas: boolean }>> {
  try {
    if (!(await temAcessoAoProjeto(projetoId, userEmail))) return { ok: false, error: 'Acesso negado' };

    const projeto = await prisma.projeto.findUnique({ where: { id: projetoId }, select: { inscricoes_abertas: true } });
    if (!projeto) return { ok: false, error: 'Projeto não encontrado' };

    const newValue = !projeto.inscricoes_abertas;

    await prisma.projeto.update({
      where: { id: projetoId },
      data: {
        inscricoes_abertas: newValue,
        status: newValue ? 'INSCRICOES_ABERTAS' : 'ATIVO',
      },
    });
    await sincronizarProjetoSintetico(projetoId).catch(console.error);

    return { ok: true, data: { inscricoes_abertas: newValue } };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

export async function updateInscricaoStatus(
  inscricaoId: string,
  status: string,
  observacao: string | undefined,
  userEmail: string
): Promise<ActionResult> {
  try {
    // Buscar inscrição atual antes de atualizar
    const inscricaoAtual = await prisma.inscricao.findUnique({
      where: { id: inscricaoId },
      include: { projeto: { select: { id: true, nome: true } } },
    });

    if (!inscricaoAtual) {
      return { ok: false, error: 'Inscrição não encontrada' };
    }

    // Verify caller is coordinator of the project — sempre checado, nunca opcional
    // (era `userEmail?: string` com essa checagem pulada quando omitido: qualquer
    // um conseguia alterar o status de qualquer inscrição sem autenticação nenhuma).
    if (!(await temAcessoAoProjeto(inscricaoAtual.projeto.id, userEmail))) {
      return { ok: false, error: 'Acesso negado: você não é coordenador deste projeto' };
    }

    // Seleção por vaga: não deixa selecionar além da quantidade de posições da vaga
    if (status === 'selecionado' && inscricaoAtual.vaga_id) {
      const vaga = await prisma.vaga.findUnique({
        where: { id: inscricaoAtual.vaga_id },
        select: { titulo: true, quantidade: true },
      });
      if (vaga) {
        const jaSelecionados = await prisma.inscricao.count({
          where: { vaga_id: inscricaoAtual.vaga_id, status: 'selecionado', id: { not: inscricaoId } },
        });
        if (jaSelecionados >= vaga.quantidade) {
          return {
            ok: false,
            error: `A vaga "${vaga.titulo}" já está com todas as ${vaga.quantidade} posição(ões) preenchida(s). Aumente a quantidade da vaga ou coloque este candidato em lista de espera.`,
          };
        }
      }
    }

    await prisma.inscricao.update({
      where: { id: inscricaoId },
      data: {
        status,
        ...(observacao !== undefined ? { observacao_interna: observacao } : {}),
      },
    });

    // Enviar e-mail de atualização de status
    if (inscricaoAtual.email) {
      enviarAtualizacaoStatus({
        protocolo: inscricaoAtual.protocolo,
        nomeCompleto: inscricaoAtual.nome_completo,
        email: inscricaoAtual.email,
        projetoNome: inscricaoAtual.projeto.nome,
        novoStatus: status,
        observacao,
      }).catch(console.error);
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

// ==================== VAGAS ====================

export type VagaFormData = {
  titulo: string;
  tipo: 'BOLSISTA' | 'VOLUNTARIO' | 'AMBOS';
  descricao?: string;
  requisitos?: string;
  quantidade: number;
  valorBolsa?: number;
  cargaHorariaSemanal?: number;
  vigenciaMeses?: number;
  fontePagadora?: string;
  dataEncerramento?: string;
};

async function checkCoordenadorDoProjeto(projetoId: string, userEmail: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const acesso = await temAcessoAoProjeto(projetoId, userEmail);
  return acesso ? { ok: true } : { ok: false, error: 'Acesso negado: você não é coordenador deste projeto' };
}

/** Lista as vagas do projeto, com o total já selecionado em cada uma. */
export async function listVagas(projetoId: string, userEmail: string) {
  const auth = await checkCoordenadorDoProjeto(projetoId, userEmail);
  if (!auth.ok) return auth;

  const vagas = await prisma.vaga.findMany({
    where: { projetoId },
    orderBy: { createdAt: 'desc' },
  });

  const contagens = await prisma.inscricao.groupBy({
    by: ['vaga_id'],
    where: { vaga_id: { in: vagas.map((v) => v.id) }, status: 'selecionado' },
    _count: true,
  });
  const contagemPorVaga = new Map(contagens.map((c) => [c.vaga_id, c._count]));

  return {
    ok: true,
    data: vagas.map((v) => ({ ...v, selecionados: contagemPorVaga.get(v.id) ?? 0 })),
  } as const;
}

export async function createVaga(projetoId: string, data: VagaFormData, userEmail: string): Promise<ActionResult<{ id: string }>> {
  try {
    const auth = await checkCoordenadorDoProjeto(projetoId, userEmail);
    if (!auth.ok) return auth;

    const titulo = data.titulo?.trim();
    if (!titulo) return { ok: false, error: 'Título da vaga é obrigatório' };
    if (!data.quantidade || data.quantidade < 1) return { ok: false, error: 'Quantidade deve ser pelo menos 1' };

    const vaga = await prisma.vaga.create({
      data: {
        projetoId,
        titulo,
        tipo: data.tipo,
        descricao: data.descricao?.trim() || null,
        requisitos: data.requisitos?.trim() || null,
        quantidade: data.quantidade,
        valorBolsa: data.valorBolsa ?? null,
        cargaHorariaSemanal: data.cargaHorariaSemanal ?? null,
        vigenciaMeses: data.vigenciaMeses ?? null,
        fontePagadora: data.fontePagadora?.trim() || null,
        dataAbertura: new Date(),
        dataEncerramento: data.dataEncerramento ? new Date(data.dataEncerramento) : null,
        status: 'ABERTA',
      },
    });
    cache.invalidate('chat:');

    return { ok: true, data: { id: vaga.id } };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

export async function updateVaga(
  vagaId: string,
  data: Partial<VagaFormData> & { status?: 'ABERTA' | 'EM_SELECAO' | 'ENCERRADA' | 'CANCELADA' },
  userEmail: string
): Promise<ActionResult> {
  try {
    const vaga = await prisma.vaga.findUnique({ where: { id: vagaId }, select: { projetoId: true } });
    if (!vaga) return { ok: false, error: 'Vaga não encontrada' };

    const auth = await checkCoordenadorDoProjeto(vaga.projetoId, userEmail);
    if (!auth.ok) return auth;

    if (data.quantidade !== undefined && data.quantidade < 1) {
      return { ok: false, error: 'Quantidade deve ser pelo menos 1' };
    }

    const updateData: Prisma.VagaUpdateInput = {};
    if (data.titulo !== undefined) updateData.titulo = data.titulo.trim();
    if (data.tipo !== undefined) updateData.tipo = data.tipo;
    if (data.descricao !== undefined) updateData.descricao = data.descricao?.trim() || null;
    if (data.requisitos !== undefined) updateData.requisitos = data.requisitos?.trim() || null;
    if (data.quantidade !== undefined) updateData.quantidade = data.quantidade;
    if (data.valorBolsa !== undefined) updateData.valorBolsa = data.valorBolsa;
    if (data.cargaHorariaSemanal !== undefined) updateData.cargaHorariaSemanal = data.cargaHorariaSemanal;
    if (data.vigenciaMeses !== undefined) updateData.vigenciaMeses = data.vigenciaMeses;
    if (data.fontePagadora !== undefined) updateData.fontePagadora = data.fontePagadora?.trim() || null;
    if (data.dataEncerramento !== undefined) {
      updateData.dataEncerramento = data.dataEncerramento ? new Date(data.dataEncerramento) : null;
    }
    if (data.status !== undefined) updateData.status = data.status;

    await prisma.vaga.update({ where: { id: vagaId }, data: updateData });
    cache.invalidate('chat:');

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

/**
 * Exclui uma vaga sem inscrições vinculadas. Se já houver candidatos, o
 * coordenador deve encerrar a vaga (`updateVaga` com `status: 'ENCERRADA'`)
 * em vez de excluir, para não perder o vínculo `vaga_id` de quem já se
 * inscreveu (a FK é `onDelete: SetNull`, então excluir não apaga a inscrição,
 * mas apaga a informação de qual vaga era).
 */
export async function deleteVaga(vagaId: string, userEmail: string): Promise<ActionResult> {
  try {
    const vaga = await prisma.vaga.findUnique({ where: { id: vagaId }, select: { projetoId: true } });
    if (!vaga) return { ok: false, error: 'Vaga não encontrada' };

    const auth = await checkCoordenadorDoProjeto(vaga.projetoId, userEmail);
    if (!auth.ok) return auth;

    const vinculadas = await prisma.inscricao.count({ where: { vaga_id: vagaId } });
    if (vinculadas > 0) {
      return {
        ok: false,
        error: `Não é possível excluir: há ${vinculadas} inscrição(ões) vinculada(s) a esta vaga. Encerre a vaga em vez de excluir.`,
      };
    }

    await prisma.vaga.delete({ where: { id: vagaId } });
    cache.invalidate('chat:');

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

// ==================== POSTS ====================

export type PostFormData = {
  titulo: string;
  conteudo: string;
  resumo?: string;
  imagemUrl?: string;
  status: 'RASCUNHO' | 'PUBLICADO';
};

export async function listPosts(projetoId: string, userEmail: string) {
  if (!(await temAcessoAoProjeto(projetoId, userEmail))) return { ok: false, error: 'Acesso negado' } as const;

  const posts = await prisma.post.findMany({
    where: { projetoId },
    orderBy: { createdAt: 'desc' },
  });

  return { ok: true, data: posts } as const;
}

export async function createPost(projetoId: string, data: PostFormData, userEmail: string): Promise<ActionResult> {
  try {
    if (!(await temAcessoAoProjeto(projetoId, userEmail))) return { ok: false, error: 'Acesso negado' };

    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) return { ok: false, error: 'Usuário não encontrado' };

    const slug = slugify(data.titulo) + '-' + Date.now().toString(36);

    await prisma.post.create({
      data: {
        titulo: data.titulo,
        slug,
        conteudo: sanitizeHtml(data.conteudo),
        resumo: data.resumo || null,
        imagemUrl: data.imagemUrl || null,
        status: data.status,
        projetoId,
        authorId: user.id,
      },
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

export async function updatePost(postId: string, data: PostFormData, userEmail: string): Promise<ActionResult> {
  try {
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { projetoId: true } });
    if (!post) return { ok: false, error: 'Post não encontrado' };

    if (!(await temAcessoAoProjeto(post.projetoId, userEmail))) return { ok: false, error: 'Acesso negado' };

    await prisma.post.update({
      where: { id: postId },
      data: {
        titulo: data.titulo,
        conteudo: sanitizeHtml(data.conteudo),
        resumo: data.resumo || null,
        imagemUrl: data.imagemUrl || null,
        status: data.status,
      },
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

export async function deletePost(postId: string, userEmail: string): Promise<ActionResult> {
  try {
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { projetoId: true } });
    if (!post) return { ok: false, error: 'Post não encontrado' };

    if (!(await temAcessoAoProjeto(post.projetoId, userEmail))) return { ok: false, error: 'Acesso negado' };

    await prisma.post.delete({ where: { id: postId } });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

// ==================== INSCRIÇÕES ====================

/**
 * Exporta as inscrições de um projeto em CSV — só o coordenador/admin desse
 * projeto (achado S11: qualquer chamada exportava CSV de qualquer projeto,
 * incluindo nome/email/telefone dos inscritos, sem checagem nenhuma).
 */
export async function exportInscricoesCSV(
  projetoId: string,
  userEmail: string
): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const auth = await checkCoordenadorDoProjeto(projetoId, userEmail);
  if (!auth.ok) return auth;

  const inscricoes = await prisma.inscricao.findMany({
    where: { projeto_id: projetoId },
    orderBy: { created_at: 'asc' },
  });

  const headers = ['Protocolo', 'Nome', 'Email', 'Telefone', 'Curso', 'Turma', 'Semestre', 'Tipo Interesse', 'Status', 'Data'];
  const rows = inscricoes.map((i) => [
    i.protocolo,
    i.nome_completo,
    i.email,
    i.telefone ?? '',
    i.curso ?? '',
    i.turma ?? '',
    i.semestre ?? '',
    i.tipo_interesse,
    i.status,
    i.created_at.toLocaleDateString('pt-BR'),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
  return { ok: true, csv };
}
