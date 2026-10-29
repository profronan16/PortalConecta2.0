'use server';

import { prisma } from '@/lib/prisma';
import { slugify, translatePrismaError } from '@/lib/utils';
import { MENSAGENS } from '@/lib/mensagens';
import { enviarAtualizacaoStatus } from '@/lib/email';
import { cache } from '@/lib/cache';
import { sincronizarProjetoSintetico } from '@/lib/projeto-sintetico';
import { sanitizeHtml } from '@/lib/rich-text';
import type { PerguntaExtra } from '@/lib/formulario-extra';
import { isAdministradorGeral, projetosAcessiveis, temAcessoAoProjeto, whereUsuarioTemAcessoAoProjeto, permissaoDeGestor, projetosComoGestor } from '@/lib/permissions';
// Meu trabalho (edição controlada + notificação no portal):
import { camposBloqueadosParaEdicao, deveRegenerarSlugDoProjeto, filtrarEdicaoProjeto } from '@/lib/projetos-edicao';
import { criarNotificacao, notificarMudancaStatusInscricao } from '@/lib/notificacoes';
import { getVerifiedServerSession } from '@/lib/session';
import { rotuloRespostaAluno } from '@/lib/inscricao-aluno';
import { mensagemVagaLotada } from '@/lib/vagas';
import { limparAnexosRemovidos, validarMidiasDoPost } from '@/lib/post-midias-server';
import { chaveDeIconeValida, erroDeUrlDeCapa } from '@/lib/post-capa';
import { normalizarEstudantes, normalizarFinanciamento } from '@/lib/projetos-equipe';
import { validarDocumentoHtml, type DocumentoHtmlRecebido } from '@/lib/post-documento-html';
import { chaveDoDiaBrasil, fimDoDiaBrasil, inicioDoDiaBrasil, parseDataDoFormulario, formatarDataBrasil } from '@/lib/datas';
import {
  LIMITES, OPCOES, validarCampos, validarCorHexadecimal, validarEmail, validarJsonPequeno,
  validarListaDeTextos, validarNumero, validarOpcao, validarSePresente, validarTexto,
  validarTextoOpcional, validarUrl, validarUrls, type Validado,
} from '@/lib/validacao';
// Já existia em produção (armazenamento local de arquivos / eventos de edital):
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
  resumoCurto?: string;
  status: string;
  corPrimaria: string;
  logoUrl?: string;
  bannerUrl?: string;
  email?: string;
  instagram?: string;
  site?: string;
  /** Equipe de estudantes exibida na página pública (ver src/lib/projetos-equipe.ts). */
  estudantesBolsistas?: string[];
  estudantesVoluntarios?: string[];
  /** Fontes de financiamento exibidas como selos junto ao resumo. */
  financiamento?: string[];
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

/**
 * Projetos em que o usuário é GESTOR DA PÁGINA (aluno bolsista/voluntário).
 * Fica separado de `listMyProjetos` para não misturar com o vínculo de
 * coordenação: o gestor tem um painel limitado.
 */
export async function listProjetosQueGerencio(email: string) {
  const sessao = await getVerifiedServerSession();
  if (!sessao?.email || sessao.email.toLowerCase() !== email.toLowerCase()) return [];

  const ids = await projetosComoGestor(email);
  if (ids.length === 0) return [];

  return prisma.projeto.findMany({
    where: { id: { in: ids } },
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { inscricoes: true } } },
  });
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

// ==================== GESTÃO DA PÁGINA (aluno gestor) ====================

export type PaginaProjetoFormData = {
  resumoCurto?: string;
  descricao?: string;
  logoUrl?: string;
  bannerUrl?: string;
  corPrimaria?: string;
  email?: string;
  instagram?: string;
  site?: string;
};

export type GestorDaPagina = {
  userId: string;
  nome: string;
  email: string;
  desde: Date;
};

export type CandidatoAGestor = {
  userId: string;
  nome: string;
  email: string;
  tipoInteresse: string;
  jaEhGestor: boolean;
};

/**
 * Dados de apresentação da página que o gestor PODE editar.
 * Nada de coordenador, status, SUAP, vagas, inscrições ou exclusão.
 */
export async function getPaginaDoProjeto(projetoId: string, userEmail: string) {
  if (!(await temAcessoAoProjeto(projetoId, userEmail, { incluirGestor: true }))) return null;

  return prisma.projeto.findUnique({
    where: { id: projetoId },
    select: {
      id: true,
      nome: true,
      slug: true,
      resumoCurto: true,
      descricao: true,
      logoUrl: true,
      bannerUrl: true,
      corPrimaria: true,
      email: true,
      instagram: true,
      site: true,
    },
  });
}

/** Salva apenas a apresentação da página — exclusivo de quem coordena ou gere. */
export async function salvarPaginaDoProjeto(
  projetoId: string,
  data: PaginaProjetoFormData,
  userEmail: string,
): Promise<ActionResult> {
  try {
    if (!(await temAcessoAoProjeto(projetoId, userEmail, { incluirGestor: true }))) {
      return { ok: false, error: MENSAGENS.semPermissao };
    }

    const resumoCurto = (data.resumoCurto ?? '').trim();
    const descricao = (data.descricao ?? '').trim();
    const logoUrl = (data.logoUrl ?? '').trim();
    const bannerUrl = (data.bannerUrl ?? '').trim();
    const corPrimaria = (data.corPrimaria ?? '').trim();
    const email = (data.email ?? '').trim();
    const instagram = (data.instagram ?? '').trim();
    const site = (data.site ?? '').trim();

    if (resumoCurto.length > 200) {
      return { ok: false, error: 'O resumo da página deve ter no máximo 200 caracteres.' };
    }
    if (descricao.length > 8000) {
      return { ok: false, error: 'A descrição da página deve ter no máximo 8.000 caracteres.' };
    }
    if (logoUrl && !/^(https?:\/\/|\/)/i.test(logoUrl)) {
      return { ok: false, error: 'A logo precisa ser uma URL http(s) ou um arquivo enviado pelo portal.' };
    }
    if (bannerUrl && !/^(https?:\/\/|\/)/i.test(bannerUrl)) {
      return { ok: false, error: 'A capa precisa ser uma URL http(s) ou um arquivo enviado pelo portal.' };
    }
    if (corPrimaria && !/^#[0-9a-f]{6}$/i.test(corPrimaria)) {
      return { ok: false, error: 'A cor principal precisa estar no formato #RRGGBB.' };
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: 'Informe um e-mail de contato válido.' };
    }
    if (site && !/^https?:\/\//i.test(site)) {
      return { ok: false, error: 'O site precisa começar com http:// ou https://.' };
    }
    if (instagram.length > 120) {
      return { ok: false, error: 'O Instagram informado é longo demais.' };
    }

    await prisma.projeto.update({
      where: { id: projetoId },
      data: {
        resumoCurto: resumoCurto || null,
        descricao: descricao || null,
        logoUrl: logoUrl || null,
        bannerUrl: bannerUrl || null,
        corPrimaria: corPrimaria || '#2F52D3',
        email: email || null,
        instagram: instagram || null,
        site: site || null,
      },
    });
    cache.invalidate('chat:');
    cache.invalidate('home:');
    await sincronizarProjetoSintetico(projetoId).catch(console.error);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

/** Lista quem já é gestor da página (só coordenação/admin vê). */
export async function listarGestoresDaPagina(projetoId: string, userEmail: string) {
  if (!(await temAcessoAoProjeto(projetoId, userEmail))) {
    return { ok: false as const, error: MENSAGENS.semPermissaoCoordenador };
  }

  const permissoes = await prisma.userPermission.findMany({
    where: { permission: permissaoDeGestor(projetoId) },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { created_at: 'asc' },
  });

  return {
    ok: true as const,
    data: permissoes.map<GestorDaPagina>((p) => ({
      userId: p.user.id,
      nome: p.user.name ?? p.user.email,
      email: p.user.email,
      desde: p.created_at,
    })),
  };
}

/** Alunos selecionados no projeto que podem receber o cargo (só coordenação vê). */
export async function listarCandidatosAGestor(projetoId: string, userEmail: string) {
  if (!(await temAcessoAoProjeto(projetoId, userEmail))) {
    return { ok: false as const, error: MENSAGENS.semPermissaoCoordenador };
  }

  const [inscricoes, permissoes] = await Promise.all([
    prisma.inscricao.findMany({
      where: { projeto_id: projetoId, status: 'selecionado', user_id: { not: null } },
      orderBy: { nome_completo: 'asc' },
      select: {
        user_id: true,
        nome_completo: true,
        email: true,
        tipo_interesse: true,
      },
    }),
    prisma.userPermission.findMany({
      where: { permission: permissaoDeGestor(projetoId) },
      select: { user_id: true },
    }),
  ]);

  const gestores = new Set(permissoes.map((p) => p.user_id));
  const vistos = new Set<string>();
  const candidatos: CandidatoAGestor[] = [];

  for (const inscricao of inscricoes) {
    if (!inscricao.user_id || vistos.has(inscricao.user_id)) continue;
    vistos.add(inscricao.user_id);
    candidatos.push({
      userId: inscricao.user_id,
      nome: inscricao.nome_completo,
      email: inscricao.email,
      tipoInteresse: inscricao.tipo_interesse,
      jaEhGestor: gestores.has(inscricao.user_id),
    });
  }

  return { ok: true as const, data: candidatos };
}

/**
 * Concede/remove o cargo de gestor da página.
 * Exige coordenador/vice/admin e que o aluno esteja SELECIONADO no projeto.
 */
export async function definirGestorDaPagina(
  projetoId: string,
  targetUserId: string,
  ativo: boolean,
  userEmail: string,
): Promise<ActionResult> {
  try {
    if (!(await temAcessoAoProjeto(projetoId, userEmail))) {
      return { ok: false, error: MENSAGENS.semPermissaoCoordenador };
    }

    const [projeto, alvo, autor] = await Promise.all([
      prisma.projeto.findUnique({ where: { id: projetoId }, select: { nome: true } }),
      prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, name: true, email: true } }),
      prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } }),
    ]);

    if (!projeto) return { ok: false, error: 'Projeto não encontrado.' };
    if (!alvo) return { ok: false, error: 'Usuário não encontrado.' };

    const permission = permissaoDeGestor(projetoId);

    if (ativo) {
      const selecionado = await prisma.inscricao.findFirst({
        where: { projeto_id: projetoId, user_id: targetUserId, status: 'selecionado' },
        select: { id: true },
      });
      if (!selecionado) {
        return {
          ok: false,
          error: 'Só um aluno selecionado neste projeto (bolsista ou voluntário) pode ser gestor da página.',
        };
      }

      await prisma.userPermission.upsert({
        where: { user_id_permission: { user_id: targetUserId, permission } },
        update: { granted_by: autor?.id ?? null },
        create: { user_id: targetUserId, permission, granted_by: autor?.id ?? null },
      });

      await criarNotificacao({
        userId: targetUserId,
        titulo: `Você agora é gestor da página de "${projeto.nome}"`,
        texto:
          'Você pode editar os posts e a apresentação da página do projeto. ' +
          'Vagas, inscrições e dados institucionais continuam com a coordenação.',
        link: `/professor/projetos/${projetoId}/pagina`,
      }).catch(console.error);
    } else {
      await prisma.userPermission.deleteMany({
        where: { user_id: targetUserId, permission },
      });
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

/**
 * Resumo mínimo do projeto para a tela de posts (gestor incluído).
 * Não devolve coordenadores, inscrições nem nada sensível.
 */
export async function getProjetoParaConteudo(projetoId: string, userEmail: string) {
  if (!(await temAcessoAoProjeto(projetoId, userEmail, { incluirGestor: true }))) return null;

  return prisma.projeto.findUnique({
    where: { id: projetoId },
    select: { id: true, nome: true, slug: true },
  });
}

export async function listInscricoes(projetoId: string, userEmail: string) {
  if (!(await temAcessoAoProjeto(projetoId, userEmail))) {
    return { ok: false, error: MENSAGENS.semPermissao } as const;
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
export async function updateMyProjeto(
  projetoId: string,
  data: MyProjetoFormData,
  userEmail?: string,
): Promise<ActionResult<{ ignorados: string[] }>> {
  try {
    // `userEmail` sempre checado — nunca opcional. Ver mesmo raciocínio em
    // updateInscricaoStatus: torná-lo opcional permitia pular a checagem só
    // omitindo o parâmetro numa chamada direta à Server Action.
    if (!userEmail) return { ok: false, error: MENSAGENS.naoAutenticado };
    if (!(await temAcessoAoProjeto(projetoId, userEmail))) {
      return { ok: false, error: MENSAGENS.semPermissaoCoordenador };
    }

    const atual = await prisma.projeto.findUnique({
      where: { id: projetoId },
      // `nome` entra aqui para comparar antes de mexer no slug (ver abaixo).
      select: { suapId: true, source: true, nome: true },
    });
    if (!atual) return { ok: false, error: 'Não encontramos este projeto. Ele pode ter sido removido por outra pessoa.' };

    // ROADMAP 2.10: em projeto vindo do SUAP, os campos institucionais são
    // bloqueados no SERVIDOR (desabilitar o input na tela é só conveniência).
    const bloqueados = camposBloqueadosParaEdicao(atual);
    const { permitido, ignorados } = filtrarEdicaoProjeto(
      {
        nome: data.nome,
        coordenador: data.coordenador,
        area: data.area,
        status: data.status,
        descricao: data.descricao || null,
        resumoCurto: data.resumoCurto || null,
        corPrimaria: data.corPrimaria,
        logoUrl: data.logoUrl || null,
        bannerUrl: data.bannerUrl || null,
        email: data.email || null,
        instagram: data.instagram || null,
        site: data.site || null,
        estudantesBolsistas: data.estudantesBolsistas,
        estudantesVoluntarios: data.estudantesVoluntarios,
        financiamento: data.financiamento,
        formularioExtra: data.formularioExtra,
      },
      bloqueados,
    );

    // ── Limites de entrada ───────────────────────────────────────────────────
    // Nome com 5 mil caracteres quebrava o card e a listagem; `site`/`instagram`
    // viram `href` na página pública (nada de `javascript:`); e o
    // `formularioExtra` é JSON que o aluno responde depois — sem teto, virava
    // JSONB de centenas de KB lido em toda inscrição.
    const v = validarCampos<{
      nome: string | null;
      coordenador: string | null;
      area: string | null;
      descricao: string | null;
      corPrimaria: string | null;
      email: string | null;
      formularioExtra: unknown;
      status: string | null;
      estudantesBolsistas: string[] | null;
      estudantesVoluntarios: string[] | null;
      financiamento: string[] | null;
    }>({
      nome: () => validarSePresente(permitido.nome, (x) => validarTexto(x, 'Nome do projeto', LIMITES.titulo)),
      coordenador: () => validarSePresente(permitido.coordenador, (x) => validarTextoOpcional(x, 'Coordenador', LIMITES.linha)),
      area: () => validarSePresente(permitido.area, (x) => validarTextoOpcional(x, 'Área', LIMITES.linha)),
      descricao: () => validarSePresente(permitido.descricao, (x) => validarTextoOpcional(x, 'Descrição', LIMITES.texto)),
      corPrimaria: () => validarSePresente(permitido.corPrimaria, (x) => validarCorHexadecimal(x, 'Cor do projeto')),
      email: () => validarSePresente<string | null>(permitido.email, (x) =>
        (typeof x === 'string' && x.trim() !== '' ? validarEmail(x, 'E-mail de contato') : { ok: true as const, valor: null }),
      ),
      formularioExtra: () => validarJsonPequeno(permitido.formularioExtra, 'Formulário de inscrição'),
      status: () => validarSePresente(permitido.status, (x) => validarOpcao(x, 'Situação do projeto', OPCOES.statusProjeto)),
      estudantesBolsistas: () => validarSePresente(permitido.estudantesBolsistas, (x) =>
        normalizarEstudantes(x, 'Estudantes bolsistas'),
      ),
      estudantesVoluntarios: () => validarSePresente(permitido.estudantesVoluntarios, (x) =>
        normalizarEstudantes(x, 'Estudantes voluntários'),
      ),
      financiamento: () => validarSePresente(permitido.financiamento, (x) =>
        normalizarFinanciamento(x),
      ),
    });
    if (!v.ok) return v;

    const urls = validarUrls({
      site: { valor: permitido.site, rotulo: 'Site' },
      instagram: { valor: permitido.instagram, rotulo: 'Instagram' },
    });
    if (!urls.ok) return urls;

    const update: Prisma.ProjetoUpdateInput = {};
    if (permitido.nome !== undefined && v.valor.nome) {
      const novoNome = v.valor.nome;
      update.nome = novoNome;
      // O slug é a URL PÚBLICA do projeto (a que o professor compartilha com os
      // estudantes e a que o botão "Ver no portal" abre). Só regenera quando o
      // nome muda de verdade — antes, qualquer salvamento (trocar a cor, a
      // descrição) reescrevia o endereço por baixo.
      if (deveRegenerarSlugDoProjeto(atual.nome, novoNome)) update.slug = slugify(novoNome);
    }
    if (permitido.coordenador !== undefined) update.coordenador = v.valor.coordenador ?? '';
    if (permitido.area !== undefined) update.area = v.valor.area ?? '';
    if (permitido.status !== undefined) update.status = v.valor.status as Prisma.ProjetoUpdateInput['status'];
    if (permitido.descricao !== undefined) update.descricao = v.valor.descricao;
    if (permitido.resumoCurto !== undefined) {
      const resumo = String(permitido.resumoCurto ?? '').trim();
      if (resumo.length > 200) {
        return { ok: false, error: 'O resumo curto deve ter no máximo 200 caracteres.' };
      }
      update.resumoCurto = resumo || null;
    }
    if (permitido.corPrimaria !== undefined) update.corPrimaria = v.valor.corPrimaria ?? undefined;
    for (const campo of ['logoUrl', 'bannerUrl'] as const) {
      const valor = permitido[campo];
      if (valor === undefined) continue;
      const url = String(valor ?? '').trim();
      if (url && !/^(https?:\/\/|\/)/i.test(url)) {
        return { ok: false, error: 'A logo/capa precisa ser uma URL http(s) ou um arquivo enviado pelo portal.' };
      }
      update[campo] = url || null;
    }
    if (permitido.email !== undefined) update.email = v.valor.email;
    if (permitido.instagram !== undefined) update.instagram = urls.valor.instagram;
    if (permitido.site !== undefined) update.site = urls.valor.site;
    if (permitido.formularioExtra !== undefined) {
      update.formulario_extra = v.valor.formularioExtra as Prisma.InputJsonValue;
    }
    if (permitido.estudantesBolsistas !== undefined) {
      update.estudantesBolsistas = v.valor.estudantesBolsistas ?? [];
    }
    if (permitido.estudantesVoluntarios !== undefined) {
      update.estudantesVoluntarios = v.valor.estudantesVoluntarios ?? [];
    }
    if (permitido.financiamento !== undefined) {
      update.financiamento = v.valor.financiamento ?? [];
    }

    if (Object.keys(update).length === 0) {
      return { ok: true, data: { ignorados } };
    }

    await prisma.projeto.update({ where: { id: projetoId }, data: update });
    cache.invalidate('chat:');
    cache.invalidate('home:');
    await sincronizarProjetoSintetico(projetoId).catch(console.error);

    return { ok: true, data: { ignorados } };
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
    if (!(await temAcessoAoProjeto(projetoId, userEmail))) return { ok: false, error: MENSAGENS.semPermissao };
    if (!data.inscricaoFim) return { ok: false, error: 'Informe o prazo final das inscrições' };

    await prisma.projeto.update({
      where: { id: projetoId },
      data: {
        inscricoes_abertas: true,
        status: 'INSCRICOES_ABERTAS',
        // Datas do modal "Abrir inscrições" (input type="date"): gravadas ao
        // meio-dia no Brasil para não caírem no dia anterior na tela.
        inscricao_inicio: parseDataDoFormulario(data.inscricaoInicio) ?? new Date(),
        inscricao_fim: parseDataDoFormulario(data.inscricaoFim) as Date,
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
    if (!(await temAcessoAoProjeto(projetoId, userEmail))) return { ok: false, error: MENSAGENS.semPermissao };

    const projeto = await prisma.projeto.findUnique({ where: { id: projetoId }, select: { inscricoes_abertas: true } });
    if (!projeto) return { ok: false, error: 'Não encontramos este projeto. Ele pode ter sido removido por outra pessoa.' };

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
      include: { projeto: { select: { id: true, nome: true, slug: true } } },
    });

    if (!inscricaoAtual) {
      return { ok: false, error: 'Não encontramos esta inscrição. Ela pode ter sido removida por outra pessoa.' };
    }

    // Verify caller is coordinator of the project — sempre checado, nunca opcional
    // (era `userEmail?: string` com essa checagem pulada quando omitido: qualquer
    // um conseguia alterar o status de qualquer inscrição sem autenticação nenhuma).
    if (!(await temAcessoAoProjeto(inscricaoAtual.projeto.id, userEmail))) {
      return { ok: false, error: MENSAGENS.semPermissaoCoordenador };
    }

    // Só os estados previstos na tela. Antes, qualquer string era aceita e ia
    // direto para o banco (inclusive um erro de digitação do cliente).
    const STATUS_VALIDOS = [
      'recebida', 'em_analise', 'selecionado', 'lista_espera', 'nao_selecionado', 'desistente',
    ];
    if (!STATUS_VALIDOS.includes(status)) {
      return { ok: false, error: 'Situação de inscrição inválida.' };
    }

    // A notificação só faz sentido quando o STATUS mudou. Se o professor apenas
    // salvou a mesma situação (ou só a observação interna), o aluno não recebe
    // nada — era o excesso de avisos que motivou o botão de confirmação.
    const mudouStatus = status !== inscricaoAtual.status;

    // Seleção por vaga: não deixa selecionar além da quantidade de posições da
    // vaga. Além de bloquear, a mensagem NOMEIA quem já está selecionado —
    // antes ela só dizia "já está com todas as N posições preenchidas", e quem
    // tinha acabado de mudar alguém para "desistente" ficava sem entender por
    // que a vaga continuava cheia (o ocupante era OUTRA inscrição da mesma
    // vaga, inclusive em estados antigos com mais selecionados que posições).
    if (status === 'selecionado' && inscricaoAtual.vaga_id) {
      const vaga = await prisma.vaga.findUnique({
        where: { id: inscricaoAtual.vaga_id },
        select: { titulo: true, quantidade: true },
      });
      if (vaga) {
        const ocupantes = await prisma.inscricao.findMany({
          where: { vaga_id: inscricaoAtual.vaga_id, status: 'selecionado', id: { not: inscricaoId } },
          orderBy: { created_at: 'asc' },
          select: { nome_completo: true, protocolo: true },
        });
        if (ocupantes.length >= vaga.quantidade) {
          return {
            ok: false,
            error: mensagemVagaLotada({
              titulo: vaga.titulo,
              quantidade: vaga.quantidade,
              ocupantes: ocupantes.map((o) => ({ nome: o.nome_completo, protocolo: o.protocolo })),
            }),
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

    // Efeitos colaterais DEPOIS da gravação: o status JÁ mudou no banco, então
    // nem e-mail nem aviso podem transformar a ação em erro. O `Promise.resolve()`
    // no início é de propósito — sem ele, uma falha SÍNCRONA (chave do Resend
    // ausente, por exemplo, que lança antes de devolver a promessa) estouraria
    // aqui e a coordenação veria "algo não saiu como esperado" para uma mudança
    // que, de fato, foi aplicada — e repetir a operação não resolveria nada.
    if (mudouStatus && inscricaoAtual.email) {
      void Promise.resolve()
        .then(() =>
          enviarAtualizacaoStatus({
            protocolo: inscricaoAtual.protocolo,
            nomeCompleto: inscricaoAtual.nome_completo,
            email: inscricaoAtual.email,
            projetoNome: inscricaoAtual.projeto.nome,
            novoStatus: status,
            observacao,
          }),
        )
        .catch(console.error);
    }

    // ROADMAP 6.2: espelha o aviso no portal (sino de notificações) para quem
    // se inscreveu logado. Não bloqueia a resposta nem falha a action. O destino
    // é "Meus Dados", onde o aluno responde à convocação (ver lib/notificacoes).
    if (mudouStatus) {
      void Promise.resolve()
        .then(() =>
          notificarMudancaStatusInscricao({
            userId: inscricaoAtual.user_id,
            protocolo: inscricaoAtual.protocolo,
            projetoNome: inscricaoAtual.projeto.nome,
            novoStatus: status,
          }),
        )
        .catch(console.error);
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
  return acesso ? { ok: true } : { ok: false, error: MENSAGENS.semPermissaoCoordenador };
}

/**
 * Valida os campos da vaga (usado no create e no update).
 *
 * O valor da bolsa é o caso que a coordenação citou: sem teto, um `valorBolsa`
 * de 1e308 ou negativo ia direto para o banco e aparecia no card público. Aqui
 * ele fica entre 0 e 9.999,99 com duas casas — e o resto (quantidade, carga
 * horária, vigência, tamanhos de texto) segue a mesma ideia.
 */
function validarCamposDaVaga(data: Partial<VagaFormData>): Validado<{
  titulo: string | null;
  tipo: 'BOLSISTA' | 'VOLUNTARIO' | 'AMBOS' | null;
  descricao: string | null;
  requisitos: string | null;
  quantidade: number | null;
  valorBolsa: number | null;
  cargaHorariaSemanal: number | null;
  vigenciaMeses: number | null;
  fontePagadora: string | null;
}> {
  return validarCampos<{
    titulo: string | null;
    tipo: 'BOLSISTA' | 'VOLUNTARIO' | 'AMBOS' | null;
    descricao: string | null;
    requisitos: string | null;
    quantidade: number | null;
    valorBolsa: number | null;
    cargaHorariaSemanal: number | null;
    vigenciaMeses: number | null;
    fontePagadora: string | null;
  }>({
    titulo: () => (data.titulo !== undefined
      ? validarTexto(data.titulo, 'Título da vaga', LIMITES.titulo)
      : { ok: true as const, valor: null }),
    tipo: () => (data.tipo !== undefined
      ? validarOpcao(data.tipo, 'Tipo da vaga', OPCOES.tipoInteresse)
      : { ok: true as const, valor: null }),
    descricao: () => validarTextoOpcional(data.descricao, 'Descrição', LIMITES.texto),
    requisitos: () => validarTextoOpcional(data.requisitos, 'Requisitos', LIMITES.texto),
    quantidade: () => validarNumero(data.quantidade, 'Quantidade de vagas', LIMITES.quantidadeVagas, { inteiro: true, opcional: true }),
    valorBolsa: () => validarNumero(data.valorBolsa, 'Valor da bolsa', LIMITES.valorBolsa, { opcional: true }),
    cargaHorariaSemanal: () => validarNumero(data.cargaHorariaSemanal, 'Carga horária semanal', LIMITES.cargaHoraria, { inteiro: true, opcional: true }),
    vigenciaMeses: () => validarNumero(data.vigenciaMeses, 'Vigência (meses)', LIMITES.vigenciaMeses, { inteiro: true, opcional: true }),
    fontePagadora: () => validarTextoOpcional(data.fontePagadora, 'Fonte pagadora', LIMITES.linha),
  });
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

    const v = validarCamposDaVaga(data);
    if (!v.ok) return v;
    if (!v.valor.titulo) return { ok: false, error: MENSAGENS.campoObrigatorio('Título da vaga') };
    if (!v.valor.quantidade) return { ok: false, error: 'Informe a quantidade de vagas (pelo menos 1).' };

    const vaga = await prisma.vaga.create({
      data: {
        projetoId,
        titulo: v.valor.titulo,
        tipo: v.valor.tipo ?? 'BOLSISTA',
        descricao: v.valor.descricao,
        requisitos: v.valor.requisitos,
        quantidade: v.valor.quantidade,
        valorBolsa: v.valor.valorBolsa,
        cargaHorariaSemanal: v.valor.cargaHorariaSemanal,
        vigenciaMeses: v.valor.vigenciaMeses,
        fontePagadora: v.valor.fontePagadora,
        dataAbertura: new Date(),
        dataEncerramento: data.dataEncerramento ? parseDataDoFormulario(data.dataEncerramento) : null,
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
    if (!vaga) return { ok: false, error: 'Não encontramos esta vaga. Ela pode ter sido removida por outra pessoa.' };

    const auth = await checkCoordenadorDoProjeto(vaga.projetoId, userEmail);
    if (!auth.ok) return auth;

    const v = validarCamposDaVaga(data);
    if (!v.ok) return v;

    const updateData: Prisma.VagaUpdateInput = {};
    if (v.valor.titulo !== null) updateData.titulo = v.valor.titulo;
    if (v.valor.tipo !== null) updateData.tipo = v.valor.tipo;
    if (data.descricao !== undefined) updateData.descricao = v.valor.descricao;
    if (data.requisitos !== undefined) updateData.requisitos = v.valor.requisitos;
    if (v.valor.quantidade !== null) updateData.quantidade = v.valor.quantidade;
    if (data.valorBolsa !== undefined) updateData.valorBolsa = v.valor.valorBolsa;
    if (data.cargaHorariaSemanal !== undefined) updateData.cargaHorariaSemanal = v.valor.cargaHorariaSemanal;
    if (data.vigenciaMeses !== undefined) updateData.vigenciaMeses = v.valor.vigenciaMeses;
    if (data.fontePagadora !== undefined) updateData.fontePagadora = v.valor.fontePagadora;
    if (data.dataEncerramento !== undefined) {
      updateData.dataEncerramento = data.dataEncerramento ? parseDataDoFormulario(data.dataEncerramento) : null;
    }
    if (data.status !== undefined) {
      const status = validarOpcao(data.status, 'Situação da vaga', OPCOES.statusVaga);
      if (!status.ok) return status;
      updateData.status = status.valor;
    }

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
    if (!vaga) return { ok: false, error: 'Não encontramos esta vaga. Ela pode ter sido removida por outra pessoa.' };

    const auth = await checkCoordenadorDoProjeto(vaga.projetoId, userEmail);
    if (!auth.ok) return auth;

    const vinculadas = await prisma.inscricao.count({ where: { vaga_id: vagaId } });
    if (vinculadas > 0) {
      return {
        ok: false,
        error: `${vinculadas === 1 ? 'Esta vaga tem 1 inscrição' : `Esta vaga tem ${vinculadas} inscrições`} e por isso não pode ser excluída. Encerre a vaga em vez de excluí-la, para preservar o histórico das inscrições.`,
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
  if (!userEmail) return { ok: false, error: MENSAGENS.naoAutenticado } as const;

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
  if (!userEmail) return { ok: false, error: MENSAGENS.naoAutenticado };

  const edital = await prisma.edital.findUnique({
    where: { id: editalId },
    select: { id: true, projetoId: true, authorId: true, pdfPath: true },
  });
  if (!edital) return { ok: false, error: 'Não encontramos este edital. Ele pode ter sido removido por outra pessoa.' };

  if (isAdministradorGeral(userEmail)) return { ok: true, edital };

  if (edital.projetoId && (await temAcessoAoProjeto(edital.projetoId, userEmail))) {
    return { ok: true, edital };
  }

  const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
  if (user && edital.authorId === user.id) return { ok: true, edital };

  return { ok: false, error: 'Este edital pertence a um projeto que você não coordena, então não é possível alterá-lo.' };
}

export async function createMeuEdital(
  data: EditalFormData,
  userEmail: string
): Promise<ActionResult<{ id: string; slug: string }>> {
  try {
    if (!userEmail) return { ok: false, error: MENSAGENS.naoAutenticado };

    const isAdmin = isAdministradorGeral(userEmail);

    // Validação — mesmas regras do painel admin, para o edital não nascer
    // incompleto e sumir da página pública sem explicação.
    const titulo = data.titulo?.trim();
    const resumo = data.resumo?.trim();
    if (!titulo || titulo.length < 2) return { ok: false, error: MENSAGENS.campoObrigatorio('Título do edital') };
    if (!resumo) return { ok: false, error: MENSAGENS.campoObrigatorio('Resumo') };
    if (!data.dataEncerramento) return { ok: false, error: MENSAGENS.campoObrigatorio('Data de encerramento') };
    // `linkOficial` é OPCIONAL (mudado em 2026-10-26): a extração do PDF só o
    // preenche quando o documento traz uma URL no texto, e muitos editais
    // internos do campus não trazem nenhuma. Exigi-lo travava o salvamento
    // depois de a IA já ter extraído tudo. As páginas públicas já renderizam o
    // link condicionalmente (`edital.linkOficial && ...`).

    // Limites e URLs seguras: este edital vai para a página pública, e os campos
    // de link viram `href` (nada de `javascript:`) — ver src/lib/validacao.ts.
    const v = validarCampos<{ titulo: string; resumo: string; dataEncerramento: string }>({
      titulo: () => validarTexto(data.titulo, 'Título do edital', LIMITES.tituloLongo),
      resumo: () => validarTexto(data.resumo, 'Resumo', LIMITES.texto),
      dataEncerramento: () => validarTexto(data.dataEncerramento, 'Data de encerramento', { min: 8, max: 40 }),
    });
    if (!v.ok) return v;

    const urls = validarUrls({
      linkOficial: { valor: data.linkOficial, rotulo: 'Link oficial' },
      arquivoPdfUrl: { valor: data.arquivoPdfUrl, rotulo: 'Arquivo do edital' },
    });
    if (!urls.ok) return urls;

    let projetoId: string | null = data.projetoId?.trim() || null;

    if (!projetoId && !isAdmin) {
      return {
        ok: false,
        error: 'Selecione o projeto deste edital. Editais sem projeto vinculado só podem ser criados pelo Administrador Geral.',
      };
    }

    if (projetoId) {
      if (!(await temAcessoAoProjeto(projetoId, userEmail))) {
        return { ok: false, error: 'Você só pode alterar editais dos projetos que coordena.' };
      }
    }

    const author = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
    if (!author) return { ok: false, error: MENSAGENS.usuarioNaoEncontrado };

    // Slug do edital precisa ser único no banco. Como dois editais podem ter o
    // mesmo título, o sufixo com timestamp elimina a colisão (o admin usa só
    // `slugify` e quebra com título repetido — não replico isso aqui).
    const slug = `${slugify(data.titulo)}-${Date.now().toString(36)}`;

    const edital = await prisma.edital.create({
      data: {
        titulo: v.valor.titulo,
        slug,
        categoria: data.categoria,
        resumo: v.valor.resumo,
        dataEncerramento: new Date(v.valor.dataEncerramento),
        status: data.status,
        linkOficial: urls.valor.linkOficial,
        pdfPath: data.pdfPath ?? null,
        arquivoPdfUrl: urls.valor.arquivoPdfUrl,
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
        return { ok: false, error: 'Você só pode alterar editais dos projetos que coordena.' };
      }
    }

    if (data.titulo !== undefined && data.titulo.trim().length < 2) {
      return { ok: false, error: MENSAGENS.campoObrigatorio('Título do edital') };
    }

    // Limites de texto e URLs seguras (o edital é público; os links viram `href`).
    const v = validarCampos<{
      titulo: string | null; resumo: string | null; linkOficial: string | null; arquivoPdfUrl: string | null;
    }>({
      titulo: () => validarSePresente(data.titulo, (x) => validarTexto(x, 'Título do edital', LIMITES.tituloLongo)),
      resumo: () => validarSePresente(data.resumo, (x) => validarTextoOpcional(x, 'Resumo', LIMITES.texto)),
      linkOficial: () => validarSePresente(data.linkOficial, (x) => validarUrl(x, 'Link oficial', { opcional: true })),
      arquivoPdfUrl: () => validarSePresente(data.arquivoPdfUrl, (x) => validarUrl(x, 'Arquivo do edital', { opcional: true })),
    });
    if (!v.ok) return v;

    await prisma.edital.update({
      where: { id: editalId },
      data: {
        ...(data.titulo !== undefined && v.valor.titulo ? { titulo: v.valor.titulo } : {}),
        ...(data.categoria !== undefined ? { categoria: data.categoria } : {}),
        ...(data.resumo !== undefined ? { resumo: v.valor.resumo } : {}),
        ...(data.dataEncerramento ? { dataEncerramento: parseDataDoFormulario(data.dataEncerramento) } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.linkOficial !== undefined ? { linkOficial: v.valor.linkOficial } : {}),
        ...(data.pdfPath !== undefined ? { pdfPath: data.pdfPath } : {}),
        ...(data.arquivoPdfUrl !== undefined ? { arquivoPdfUrl: v.valor.arquivoPdfUrl } : {}),
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
  /** Chave do ícone de capa (catálogo em src/lib/post-capa.ts). */
  icone?: string | null;
  status: 'RASCUNHO' | 'PUBLICADO';
  /** Anexos (PDF, ZIP, RAR) já enviados para o storage local. */
  anexos?: unknown;
  /**
   * Post feito de um arquivo .html (src/lib/post-documento-html.ts).
   * `undefined` mantém o que já existe; `null` remove o documento (o post volta
   * a ser só o texto do editor).
   */
  documentoHtml?: DocumentoHtmlRecebido | null;
};

/**
 * Valida os campos comuns de post (create e update).
 *
 * O `conteudo` é HTML do editor rico: já passa pelo `sanitizeHtml`, mas sem teto
 * de tamanho — um post de 900 KB entraria no banco e seria carregado em toda
 * listagem pública. A `imagemUrl` vira `<img src>` na página, então também
 * precisa ser um endereço de verdade (nada de `javascript:`/`data:`).
 */
function validarCamposDoPost(data: PostFormData): Validado<{
  titulo: string;
  resumo: string | null;
  conteudo: string;
  imagemUrl: string | null;
  status: 'RASCUNHO' | 'PUBLICADO';
}> {
  const resultado = validarCampos<{
    titulo: string;
    resumo: string | null;
    conteudo: string;
    imagemUrl: string | null;
    status: 'RASCUNHO' | 'PUBLICADO';
  }>({
    titulo: () => validarTexto(data.titulo, 'Título', LIMITES.tituloLongo),
    resumo: () => validarTextoOpcional(data.resumo, 'Resumo', LIMITES.resumo),
    conteudo: () => validarTexto(data.conteudo, 'Conteúdo', { min: 1, max: LIMITES.html.max }),
    imagemUrl: () => validarUrl(data.imagemUrl, 'Imagem de capa', { opcional: true }),
    // O tipo diz que é RASCUNHO|PUBLICADO, mas quem chama a action direto pode
    // mandar qualquer string — e ela iria direto para o banco.
    status: () => validarOpcao(data.status, 'Situação do post', ['RASCUNHO', 'PUBLICADO'] as const),
  });

  if (!resultado.ok) return resultado;

  const erroCapa = erroDeUrlDeCapa(resultado.valor.imagemUrl);
  if (erroCapa) return { ok: false, error: erroCapa };

  return resultado;
}

export async function listPosts(projetoId: string, userEmail: string) {
  if (!(await temAcessoAoProjeto(projetoId, userEmail, { incluirGestor: true }))) return { ok: false, error: MENSAGENS.semPermissao } as const;

  const posts = await prisma.post.findMany({
    where: { projetoId },
    orderBy: { createdAt: 'desc' },
    // Só o resumo do documento: a lista precisa saber QUE o post é um HTML, não
    // carregar o arquivo de cada um (ver `getDocumentoHtmlDoPost`).
    include: { documentoHtml: { select: { nomeArquivo: true, bytes: true } } },
  });

  return { ok: true, data: posts } as const;
}

/** Documento HTML de um post, para a pré-visualização ao editar. */
export async function getDocumentoHtmlDoPost(postId: string, userEmail: string) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { projetoId: true, documentoHtml: { select: { html: true, nomeArquivo: true, bytes: true } } },
  });
  if (!post) return { ok: false, error: 'Não encontramos esta publicação. Ela pode ter sido removida por outra pessoa.' } as const;
  if (!(await temAcessoAoProjeto(post.projetoId, userEmail, { incluirGestor: true }))) return { ok: false, error: MENSAGENS.semPermissao } as const;

  return { ok: true, data: post.documentoHtml } as const;
}

export async function createPost(projetoId: string, data: PostFormData, userEmail: string): Promise<ActionResult> {
  try {
    if (!(await temAcessoAoProjeto(projetoId, userEmail, { incluirGestor: true }))) return { ok: false, error: MENSAGENS.semPermissao };

    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) return { ok: false, error: MENSAGENS.usuarioNaoEncontrado };

    // Post de documento HTML: o texto do post sai do próprio documento.
    const documento = data.documentoHtml ? validarDocumentoHtml(data.documentoHtml) : null;
    if (documento && !documento.ok) return documento;

    const v = validarCamposDoPost(documento ? { ...data, conteudo: documento.valor.conteudo } : data);
    if (!v.ok) return v;

    const conteudo = sanitizeHtml(v.valor.conteudo);
    const midias = await validarMidiasDoPost(conteudo, data.anexos);
    if (!midias.ok) return { ok: false, error: midias.error };

    const slug = slugify(v.valor.titulo) + '-' + Date.now().toString(36);

    await prisma.post.create({
      data: {
        titulo: v.valor.titulo,
        slug,
        conteudo,
        resumo: v.valor.resumo,
        imagemUrl: v.valor.imagemUrl,
        // Chave fora do catálogo vira `null` em vez de erro: o ícone é enfeite,
        // não pode impedir a publicação (e a chave inválida nunca é gravada).
        icone: chaveDeIconeValida(data.icone) ? data.icone : null,
        anexos: midias.anexos as unknown as Prisma.InputJsonValue,
        status: data.status,
        projetoId,
        authorId: user.id,
        ...(documento ? {
          documentoHtml: {
            create: { html: documento.valor.html, nomeArquivo: documento.valor.nomeArquivo, bytes: documento.valor.bytes },
          },
        } : {}),
      },
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

export async function updatePost(postId: string, data: PostFormData, userEmail: string): Promise<ActionResult> {
  try {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { projetoId: true, anexos: true },
    });
    if (!post) return { ok: false, error: 'Não encontramos esta publicação. Ela pode ter sido removida por outra pessoa.' };

    if (!(await temAcessoAoProjeto(post.projetoId, userEmail, { incluirGestor: true }))) return { ok: false, error: MENSAGENS.semPermissao };

    const documento = data.documentoHtml ? validarDocumentoHtml(data.documentoHtml) : null;
    if (documento && !documento.ok) return documento;

    const v = validarCamposDoPost(documento ? { ...data, conteudo: documento.valor.conteudo } : data);
    if (!v.ok) return v;

    const conteudo = sanitizeHtml(v.valor.conteudo);
    const midias = await validarMidiasDoPost(conteudo, data.anexos);
    if (!midias.ok) return { ok: false, error: midias.error };

    const dadosDocumento = documento
      ? { html: documento.valor.html, nomeArquivo: documento.valor.nomeArquivo, bytes: documento.valor.bytes }
      : null;

    await prisma.post.update({
      where: { id: postId },
      data: {
        titulo: v.valor.titulo,
        conteudo,
        resumo: v.valor.resumo,
        imagemUrl: v.valor.imagemUrl,
        icone: chaveDeIconeValida(data.icone) ? data.icone : null,
        anexos: midias.anexos as unknown as Prisma.InputJsonValue,
        status: data.status,
        ...(dadosDocumento ? { documentoHtml: { upsert: { create: dadosDocumento, update: dadosDocumento } } } : {}),
      },
    });

    // `null` = o professor voltou para o editor e o post passa a ser só texto.
    // `deleteMany` (e não o `delete` aninhado) porque não falha quando o post
    // nunca teve documento.
    if (data.documentoHtml === null) {
      await prisma.postDocumentoHtml.deleteMany({ where: { postId } });
    }

    // Anexo que saiu da lista sai do disco também (o botão "remover" promete
    // isso, e arquivo órfão é espaço parado na VPS). A limpeza nunca derruba a
    // atualização — ver `limparAnexosRemovidos`.
    await limparAnexosRemovidos(post.anexos, midias.anexos);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

export async function deletePost(postId: string, userEmail: string): Promise<ActionResult> {
  try {
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { projetoId: true } });
    if (!post) return { ok: false, error: 'Não encontramos esta publicação. Ela pode ter sido removida por outra pessoa.' };

    if (!(await temAcessoAoProjeto(post.projetoId, userEmail, { incluirGestor: true }))) return { ok: false, error: MENSAGENS.semPermissao };

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

  const headers = ['Protocolo', 'Nome', 'Email', 'Telefone', 'Curso', 'Turma', 'Semestre', 'Tipo Interesse', 'Status', 'Resposta do Aluno', 'Data'];
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
    // Aceite/recusa de convocação — sem esta coluna, o coordenador exportava a
    // lista e não conseguia saber quem já confirmou presença.
    rotuloRespostaAluno(i.resposta_aluno) ?? '',
    formatarDataBrasil(i.created_at, { day: '2-digit', month: '2-digit', year: 'numeric' }),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
  return { ok: true, csv };
}
