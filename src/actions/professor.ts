'use server';

import { prisma } from '@/lib/prisma';
import { slugify, translatePrismaError } from '@/lib/utils';
import { enviarAtualizacaoStatus } from '@/lib/email';
import { cache } from '@/lib/cache';
import { sincronizarProjetoSintetico } from '@/lib/projeto-sintetico';
import { sanitizeHtml } from '@/lib/rich-text';
import type { PerguntaExtra } from '@/lib/formulario-extra';
import { isAdministradorGeral, projetosAcessiveis, temAcessoAoProjeto, whereUsuarioTemAcessoAoProjeto } from '@/lib/permissions';
import { derivarEventosEdital } from '@/lib/evento-helpers';
import { removerArquivo } from '@/lib/file-storage';
import type { Prisma } from '@prisma/client';
import { CategoriaEdital, StatusEdital, ReviewStatus } from '@prisma/client';

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

// ==================== EDITAIS ====================

/**
 * Editais do escopo do professor.
 *
 * Antes desta implementação o painel do professor não tinha NENHUMA função de
 * edital — publicar edital era exclusivo do Administrador Geral
 * (`src/actions/admin.ts`). Isso contradizia o requisito do próprio projeto de
 * que o professor/coordenador publica os editais dos SEUS projetos.
 *
 * Modelo de autorização usado aqui:
 *  - Administrador Geral: vê e edita todos os editais (mesma regra de
 *    `temAcessoAoProjeto`, que já retorna `true` para ele).
 *  - Professor: só vê/edita/cria editais vinculados a projeto do qual seja
 *    coordenador, vice ou admin (`temAcessoAoProjeto`).
 *  - Criar edital SEM projeto vinculado é privilégio do Administrador Geral —
 *    edital institucional não pertence a nenhum professor, então não haveria
 *    como verificar vínculo nenhum.
 *
 * Sobre `review_status`: o professor que preenche o formulário completo já está
 * publicando, então o edital nasce `PUBLICADO` — que é exatamente o que a
 * página pública `/editais` exige (`review_status: 'PUBLICADO'`). O
 * Administrador Geral continua podendo esconder qualquer edital pelo painel
 * admin (`toggleEditalPublicacao`), que é a válvula de moderação.
 */

export type EditalFormData = {
  titulo: string;
  categoria: CategoriaEdital;
  resumo: string;
  dataEncerramento: string;
  status: StatusEdital;
  linkOficial: string;
  /** Caminho relativo do PDF dentro de STORAGE_ROOT (campo `Edital.pdfPath`). */
  pdfPath?: string;
  /** URL pública do PDF servida pelo nginx (campo `Edital.arquivoPdfUrl`). */
  arquivoPdfUrl?: string;
  destaque?: boolean;
  /** Projeto dono do edital. Obrigatório para professor, opcional para admin. */
  projetoId?: string | null;
  traducaoIFizinha: {
    oquee: string;
    quempode: string;
    beneficios: string;
    documentos: string;
    comoinscrever: string;
    prazo: string;
    observacoes?: string;
  };
};

/** Projetos que o professor pode vincular a um edital (todos, se for o admin). */
export async function listProjetosParaEdital(email: string) {
  const projetos = await projetosAcessiveis(email);
  return projetos.map((p) => ({ id: p.id, nome: p.nome }));
}

/** Editais vinculados aos projetos do professor (todos, se for o Administrador Geral). */
export async function listMeusEditais(userEmail: string) {
  if (!userEmail) return { ok: false, error: 'Não autenticado' } as const;

  let where: Prisma.EditalWhereInput;

  if (isAdministradorGeral(userEmail)) {
    where = { deleted_at: null };
  } else {
    // Uma query de projetos + `projetoId: { in: [...] }` em vez de filtro
    // aninhado por relação: é mais simples de ler, previsível no tipo do
    // Prisma e evita um JOIN a mais na listagem.
    const projetos = await prisma.projeto.findMany({
      where: whereUsuarioTemAcessoAoProjeto(userEmail),
      select: { id: true },
    });
    const projetoIds = projetos.map((p) => p.id);

    where = {
      deleted_at: null,
      OR: [
        ...(projetoIds.length > 0 ? [{ projetoId: { in: projetoIds } }] : []),
        // Editais que o próprio professor criou continuam visíveis para ele
        // mesmo que o vínculo com o projeto mude depois.
        { author: { email: userEmail } },
      ],
    };
  }

  const editais = await prisma.edital.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: { projeto: { select: { id: true, nome: true } } },
  });

  return { ok: true, data: editais } as const;
}

/**
 * Verifica se o e-mail pode gerenciar um edital específico.
 * Admin sempre pode; professor só se tiver vínculo com o projeto do edital ou
 * for o autor original.
 */
async function podeGerenciarEdital(
  editalId: string,
  userEmail: string
): Promise<{ ok: true; edital: { id: string; projetoId: string | null; authorId: string; pdfPath: string | null } } | { ok: false; error: string }> {
  if (!userEmail) return { ok: false, error: 'Não autenticado' };

  const edital = await prisma.edital.findUnique({
    where: { id: editalId },
    select: { id: true, projetoId: true, authorId: true, pdfPath: true },
  });
  if (!edital) return { ok: false, error: 'Edital não encontrado' };

  if (isAdministradorGeral(userEmail)) return { ok: true, edital };

  if (edital.projetoId && (await temAcessoAoProjeto(edital.projetoId, userEmail))) {
    return { ok: true, edital };
  }

  const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
  if (user && edital.authorId === user.id) return { ok: true, edital };

  return { ok: false, error: 'Acesso negado: este edital não é de um projeto seu' };
}

export async function createMeuEdital(
  data: EditalFormData,
  userEmail: string
): Promise<ActionResult<{ id: string; slug: string }>> {
  try {
    if (!userEmail) return { ok: false, error: 'Não autenticado' };

    const isAdmin = isAdministradorGeral(userEmail);

    // Validação — mesmas regras do painel admin, para o edital não nascer
    // incompleto e sumir da página pública sem explicação.
    const titulo = data.titulo?.trim();
    const resumo = data.resumo?.trim();
    if (!titulo || titulo.length < 2) return { ok: false, error: 'Título do edital é obrigatório (mínimo 2 caracteres)' };
    if (!resumo) return { ok: false, error: 'Resumo é obrigatório' };
    if (!data.dataEncerramento) return { ok: false, error: 'Data de encerramento é obrigatória' };
    if (!data.linkOficial?.trim()) return { ok: false, error: 'Link oficial é obrigatório' };

    let projetoId: string | null = data.projetoId?.trim() || null;

    if (!projetoId && !isAdmin) {
      return {
        ok: false,
        error: 'Selecione o projeto deste edital. Editais sem projeto vinculado só podem ser criados pelo Administrador Geral.',
      };
    }

    if (projetoId) {
      if (!(await temAcessoAoProjeto(projetoId, userEmail))) {
        return { ok: false, error: 'Acesso negado: você não é coordenador do projeto selecionado' };
      }
    }

    const author = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
    if (!author) return { ok: false, error: 'Usuário não encontrado' };

    // Slug do edital precisa ser único no banco. Como dois editais podem ter o
    // mesmo título, o sufixo com timestamp elimina a colisão (o admin usa só
    // `slugify` e quebra com título repetido — não replico isso aqui).
    const slug = `${slugify(data.titulo)}-${Date.now().toString(36)}`;

    const edital = await prisma.edital.create({
      data: {
        titulo,
        slug,
        categoria: data.categoria,
        resumo,
        dataEncerramento: new Date(data.dataEncerramento),
        status: data.status,
        linkOficial: data.linkOficial.trim(),
        pdfPath: data.pdfPath ?? null,
        arquivoPdfUrl: data.arquivoPdfUrl ?? null,
        destaque: data.destaque ?? false,
        traducaoIFizinha: data.traducaoIFizinha,
        projetoId,
        authorId: author.id,
        source: 'MANUAL',
        review_status: 'PUBLICADO',
      },
    });

    await derivarEventosEdital(edital.id).catch(console.error);
    cache.invalidate('chat:');
    cache.invalidate('editais:');

    return { ok: true, data: { id: edital.id, slug: edital.slug } };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

export async function updateMeuEdital(
  editalId: string,
  data: Partial<EditalFormData> & { review_status?: ReviewStatus },
  userEmail: string
): Promise<ActionResult> {
  try {
    const permissao = await podeGerenciarEdital(editalId, userEmail);
    if (!permissao.ok) return permissao;

    // Se o professor estiver trocando o projeto do edital, o novo projeto
    // também precisa ser dele — senão daria para "mover" um edital para um
    // projeto alheio e depois editá-lo por lá.
    if (data.projetoId !== undefined && data.projetoId !== null && data.projetoId !== '') {
      if (!(await temAcessoAoProjeto(data.projetoId, userEmail))) {
        return { ok: false, error: 'Acesso negado: você não é coordenador do projeto selecionado' };
      }
    }

    if (data.titulo !== undefined && data.titulo.trim().length < 2) {
      return { ok: false, error: 'Título do edital é obrigatório (mínimo 2 caracteres)' };
    }

    await prisma.edital.update({
      where: { id: editalId },
      data: {
        ...(data.titulo !== undefined ? { titulo: data.titulo.trim() } : {}),
        ...(data.categoria !== undefined ? { categoria: data.categoria } : {}),
        ...(data.resumo !== undefined ? { resumo: data.resumo.trim() } : {}),
        ...(data.dataEncerramento ? { dataEncerramento: new Date(data.dataEncerramento) } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.linkOficial !== undefined ? { linkOficial: data.linkOficial.trim() } : {}),
        ...(data.pdfPath !== undefined ? { pdfPath: data.pdfPath } : {}),
        ...(data.arquivoPdfUrl !== undefined ? { arquivoPdfUrl: data.arquivoPdfUrl } : {}),
        ...(data.destaque !== undefined ? { destaque: data.destaque } : {}),
        ...(data.traducaoIFizinha !== undefined ? { traducaoIFizinha: data.traducaoIFizinha } : {}),
        ...(data.projetoId !== undefined ? { projetoId: data.projetoId || null } : {}),
        // Publicar/despublicar o próprio edital (mesma válvula que o admin tem
        // no painel dele). O dono do edital ou o professor do projeto pode.
        ...(data.review_status !== undefined ? { review_status: data.review_status } : {}),
      },
    });

    await derivarEventosEdital(editalId).catch(console.error);
    cache.invalidate('chat:');
    cache.invalidate('editais:');

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

/**
 * Exclui o edital. Só remove o PDF do disco DEPOIS que o registro saiu do banco
 * — na ordem inversa, uma falha no delete deixaria o edital apontando para um
 * arquivo inexistente.
 */
export async function deleteMeuEdital(editalId: string, userEmail: string): Promise<ActionResult> {
  try {
    const permissao = await podeGerenciarEdital(editalId, userEmail);
    if (!permissao.ok) return permissao;

    await prisma.edital.delete({ where: { id: editalId } });

    if (permissao.edital.pdfPath) {
      await removerArquivo(permissao.edital.pdfPath).catch(() => {});
    }

    cache.invalidate('chat:');
    cache.invalidate('editais:');

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
