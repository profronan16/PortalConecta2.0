'use server';

import { prisma } from '@/lib/prisma';
import { slugify, translatePrismaError } from '@/lib/utils';
import { MENSAGENS, mensagemAmigavel } from '@/lib/mensagens';
import { cache } from '@/lib/cache';
import { getPublicMetrics } from '@/lib/metrics';
import { dispararAlertasDeEdital } from '@/lib/alertas';
import { derivarEventosEdital, derivarEventosProjeto } from '@/lib/evento-helpers';
import { LIMPEZA_TABLES } from '@/lib/limpeza-tables';
import { sincronizarProjetoSintetico, removerProjetoSintetico } from '@/lib/projeto-sintetico';
import { sanitizeHtml } from '@/lib/rich-text';
import { limparAnexosRemovidos, validarMidiasDoPost } from '@/lib/post-midias-server';
import { chaveDeIconeValida, erroDeUrlDeCapa } from '@/lib/post-capa';
import { normalizarFinanciamento, normalizarViceCoordenacao } from '@/lib/projetos-equipe';
import { validarDocumentoHtml, type DocumentoHtmlRecebido } from '@/lib/post-documento-html';
import { getVerifiedServerSession } from '@/lib/session';
import { lerVisao } from '@/lib/visao-server';
import type { Visao } from '@/lib/visao';
import { parseDataDoFormulario } from '@/lib/datas';
import type { Prisma } from '@prisma/client';
import type { PerguntaExtra } from '@/lib/formulario-extra';
import {
  isAdministradorGeral,
  isCoordenadorOuViceDoProjeto,
  PERMISSAO_ADMIN_GERAL,
  resolveUserRole,
  usuarioTemAlgumProjeto,
  usuarioTemAlgumProjetoComoGestor,
} from '@/lib/permissions';
import {
  CategoriaEdital, StatusEdital, StatusProjeto, StatusPost,
  TipoEvento, UserRole,
} from '@prisma/client';

const MASTER_ADMIN_EMAIL = process.env.ADMIN_EMAILS?.split(',')[0]?.trim();

type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Checagem de autorização no servidor — a maioria das actions deste arquivo
 * não tinha nenhuma (achado S1 do RELATORIO_TESTES.md, confirmado em revisão
 * de segurança em 2026-08-26): qualquer chamada direta à Server Action, sem
 * passar pela UI, conseguia criar/editar/excluir projetos, editais e eventos.
 * Mesmo padrão já usado em `src/actions/rag.ts`.
 *
 * ⚠️ CORREÇÃO DE 2026-10-05: conferir o PAPEL do e-mail informado não bastava —
 * o e-mail vinha do cliente (`user.email` do contexto de autenticação) e os
 * e-mails administrativos estão na documentação pública do projeto. Ou seja,
 * qualquer pessoa podia chamar `updateEdital(id, {...}, 'ronan.lopes@ifpr.edu.br')`
 * e editar o portal inteiro. A identidade agora tem de bater com o **cookie de
 * sessão verificado** (`getVerifiedServerSession`), que o cliente não forja.
 */
async function requireAdminEmail(email?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!email) return { ok: false, error: MENSAGENS.naoAutenticado };

  const sessao = await getVerifiedServerSession();
  if (!sessao?.email || sessao.email.toLowerCase() !== email.toLowerCase()) {
    return { ok: false, error: MENSAGENS.semPermissaoAdmin };
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  if (user?.role !== 'ADMIN') return { ok: false, error: MENSAGENS.semPermissaoAdmin };
  return { ok: true };
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

/**
 * Papel efetivo do e-mail — SEMPRE recalculado ao vivo (nunca só o campo
 * `role` salvo no banco): Administrador Geral (ADMIN_EMAILS) é sempre ADMIN;
 * fora do domínio institucional (@ifpr.edu.br) nunca é PROFESSOR/ADMIN; e
 * dentro do domínio só é PROFESSOR enquanto coordenar/vice-coordenar (ou
 * tiver sido explicitamente autorizado em) pelo menos um projeto. Ver
 * `src/lib/permissions.ts` para a regra completa — é o que fecha o pedido de
 * "e-mails fora do @ifpr.edu.br só acessam o próprio perfil" e "professor sem
 * projeto carregado não acessa o painel".
 */
export async function getUserRole(email: string): Promise<UserRole | null> {
  if (!email) return null;
  return resolveUserRole(email);
}

export async function ensureUser(
  email: string,
  name?: string,
): Promise<{ id: string; role: UserRole; isMasterAdmin: boolean; isGestor: boolean; visao: Visao }> {
  const user = await prisma.user.upsert({
    where: { email },
    update: name ? { name } : {},
    create: { email, name: name ?? email, role: 'ESTUDANTE' },
  });
  // Recalcula o papel ao vivo (ver getUserRole) para que o AuthContext do
  // cliente já receba ADMIN/PROFESSOR corretos no primeiro login, em vez do
  // ESTUDANTE default do upsert acima.
  const role = (await resolveUserRole(email)) ?? user.role;
  return {
    id: user.id,
    role,
    // Flags de interface: o servidor revalida tudo em cada action.
    isMasterAdmin: isAdministradorGeral(email),
    isGestor: await usuarioTemAlgumProjetoComoGestor(email),
    // "Ver como" do admin (src/lib/visao.ts) — só afeta a interface.
    visao: lerVisao(role),
  };
}

// ── Dashboard stats ───────────────────────────────────────────────────────────

export async function getDashboardStats() {
  // Fonte única (SPEC §5.1, ROADMAP 1.17): antes esta função contava editais sem
  // filtrar review_status/deleted_at e só projetos EM_EXECUCAO, enquanto a home
  // contava diferente — os dois números divergiam.
  const metrics = await getPublicMetrics();
  return {
    editaisAtivos: metrics.editaisAtivos,
    projetos: metrics.projetos,
    usuarios: metrics.usuarios,
    eventos: metrics.eventos,
  };
}

// ── Editais ───────────────────────────────────────────────────────────────────

export type EditalFormData = {
  titulo: string;
  categoria: CategoriaEdital;
  resumo: string;
  dataEncerramento: string;
  status: StatusEdital;
  linkOficial: string;
  arquivoPdfUrl?: string;
  destaque?: boolean;
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

export async function listEditais() {
  return prisma.edital.findMany({
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { name: true, email: true } } },
  });
}

export async function createEdital(
  data: EditalFormData,
  authorEmail: string,
): Promise<ActionResult<{ id: string; slug: string }>> {
  try {
    const auth = await requireAdminEmail(authorEmail);
    if (!auth.ok) return auth;

    // Server-side validation
    const titulo = data.titulo?.trim();
    const resumo = data.resumo?.trim();
    if (!titulo || titulo.length < 2) {
      return { ok: false, error: MENSAGENS.campoObrigatorio('Título do edital') };
    }
    if (!resumo) {
      return { ok: false, error: MENSAGENS.campoObrigatorio('Resumo') };
    }
    if (!data.dataEncerramento) {
      return { ok: false, error: MENSAGENS.campoObrigatorio('Data de encerramento') };
    }
    // `linkOficial` NÃO é obrigatório (mudado em 2026-10-26): a extração do PDF
    // só preenche esse campo quando o documento traz uma URL no texto — e muitos
    // editais internos do campus não trazem nenhuma. Exigir o campo travava o
    // fluxo "Preencher a partir do PDF" no momento de salvar, depois de a IA já
    // ter feito todo o trabalho. As páginas públicas já renderizam o link
    // condicionalmente (`edital.linkOficial && ...`), então ausência é segura.

    const author = await ensureUser(authorEmail);
    const slug = slugify(data.titulo);
    const edital = await prisma.edital.create({
      data: {
        titulo: data.titulo,
        slug,
        categoria: data.categoria,
        resumo: data.resumo,
        dataEncerramento: parseDataDoFormulario(data.dataEncerramento),
        status: data.status,
        linkOficial: data.linkOficial?.trim() || null,
        arquivoPdfUrl: data.arquivoPdfUrl ?? null,
        destaque: data.destaque ?? false,
        traducaoIFizinha: data.traducaoIFizinha,
        authorId: author.id,
        // Um admin preenchendo o formulário inteiro no painel já está
        // publicando o edital — não existe hoje um fluxo de rascunho/revisão
        // no admin, então deixar em RASCUNHO (default do schema) faria o
        // edital nunca aparecer em lugar nenhum do site sem nenhuma pista do
        // motivo (lacuna real encontrada e documentada na Etapa 5 do RAG).
        review_status: 'PUBLICADO',
      },
    });

    // Derivar eventos automaticamente
    await derivarEventosEdital(edital.id).catch(console.error);
    cache.invalidate('chat:');

    return { ok: true, data: { id: edital.id, slug: edital.slug } };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

export async function updateEdital(
  id: string,
  data: Partial<EditalFormData>,
  callerEmail: string,
): Promise<ActionResult> {
  try {
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    await prisma.edital.update({
      where: { id },
      data: {
        ...data,
        // `linkOficial` é opcional: o formulário manda '' quando fica em branco, e
        // '' não é o mesmo que "sem link" (a coluna é anulável). Normaliza para
        // null, sem tocar no campo quando ele nem veio neste update.
        linkOficial: data.linkOficial !== undefined ? data.linkOficial.trim() || null : undefined,
        dataEncerramento: data.dataEncerramento ? parseDataDoFormulario(data.dataEncerramento) : undefined,
        slug: data.titulo ? slugify(data.titulo) : undefined,
      },
    });

    // Re-derivar eventos quando datas mudam
    await derivarEventosEdital(id).catch(console.error);
    cache.invalidate('chat:');

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

/** Publica/despublica um edital (ADMIN apenas) — alterna `review_status` entre PUBLICADO e RASCUNHO. */
export async function toggleEditalPublicacao(id: string, callerEmail: string): Promise<ActionResult<{ review_status: string }>> {
  try {
    const caller = await prisma.user.findUnique({ where: { email: callerEmail }, select: { role: true } });
    if (caller?.role !== 'ADMIN') {
      return { ok: false, error: MENSAGENS.semPermissaoAdmin };
    }

    const edital = await prisma.edital.findUnique({ where: { id }, select: { review_status: true } });
    if (!edital) return { ok: false, error: 'Não encontramos este edital. Ele pode ter sido removido por outra pessoa.' };

    const review_status = edital.review_status === 'PUBLICADO' ? 'RASCUNHO' : 'PUBLICADO';
    await prisma.edital.update({ where: { id }, data: { review_status } });
    cache.invalidate('chat:');

    // ROADMAP 6.4: ao PUBLICAR, avisa quem assinou alerta de interesse para a
    // categoria. Fire-and-forget: uma falha de aviso não pode desfazer a
    // publicação (o disparo é idempotente por link + usuário).
    if (review_status === 'PUBLICADO') {
      dispararAlertasDeEdital(id).catch(console.error);
    }

    return { ok: true, data: { review_status } };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

export async function deleteEdital(id: string, callerEmail: string): Promise<ActionResult> {
  try {
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    await prisma.edital.delete({ where: { id } });
    cache.invalidate('chat:');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

// ── Projetos ──────────────────────────────────────────────────────────────────

export type ProjetoFormData = {
  nome: string;
  coordenador: string;
  coordenadorEmail?: string;
  viceCoordenadorNome?: string;
  viceCoordenadorEmail?: string;
  area: string;
  descricao?: string;
  resumoCurto?: string;
  dataInicio?: string;
  servidores?: string;
  alunos?: string;
  /** Fontes de financiamento exibidas como selos junto ao resumo. */
  financiamento?: string[];
  observacao?: string;
  status: StatusProjeto;
  logoUrl?: string;
  bannerUrl?: string;
  corPrimaria?: string;
  email?: string;
  instagram?: string;
  site?: string;
  destaque?: boolean;
  adminEmails?: string;
  formularioExtra?: PerguntaExtra[];
};

export async function listProjetos(userEmail?: string, userRole?: string) {
  const where = userRole === 'PROFESSOR' && userEmail 
    ? { admins: { some: { email: userEmail } } } 
    : {};
  return prisma.projeto.findMany({ 
    where,
    orderBy: { createdAt: 'desc' },
    include: { admins: { select: { email: true } } }
  });
}

/**
 * Revoga a promoção automática a PROFESSOR de quem não administra/coordena
 * mais nenhum projeto — sem isso, `syncProjectAdmins` promove ao adicionar
 * mas nunca rebaixa ao remover, virando uma escalada de privilégio
 * permanente (a pessoa continua com acesso a todo o painel /professor
 * mesmo depois de removida de todo mundo). Nunca mexe em ADMIN.
 */
async function revogarProfessorSeSemProjetos(email: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (!user || user.role !== 'PROFESSOR') return;

  if (!(await usuarioTemAlgumProjeto(email))) {
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ESTUDANTE' } });
  }
}

async function syncProjectAdmins(projetoId: string, emailsStr: string) {
  const emails = emailsStr.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

  const projetoAntes = await prisma.projeto.findUnique({
    where: { id: projetoId },
    select: { admins: { select: { email: true } } },
  });
  const emailsAntigos = projetoAntes?.admins.map((a) => a.email) ?? [];

  for (const email of emails) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await prisma.user.create({ data: { email, name: email, role: 'PROFESSOR' } });
    } else if (user.role === 'ESTUDANTE') {
      await prisma.user.update({ where: { email }, data: { role: 'PROFESSOR' } });
    }
  }

  await prisma.projeto.update({
    where: { id: projetoId },
    data: {
      admins: {
        set: emails.map(email => ({ email }))
      }
    }
  });

  const removidos = emailsAntigos.filter((email) => !emails.includes(email));
  for (const email of removidos) {
    await revogarProfessorSeSemProjetos(email);
  }
}

export async function createProjeto(data: ProjetoFormData, callerEmail: string): Promise<ActionResult<{ id: string; slug: string }>> {
  try {
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    // Server-side validation
    const nome = data.nome?.trim();
    const coordenador = data.coordenador?.trim();
    const area = data.area?.trim();
    if (!nome || nome.length < 2) {
      return { ok: false, error: MENSAGENS.campoObrigatorio('Nome do projeto') };
    }
    if (!coordenador) {
      return { ok: false, error: MENSAGENS.campoObrigatorio('Coordenador') };
    }
    if (!area) {
      return { ok: false, error: MENSAGENS.campoObrigatorio('Área') };
    }

    // Financiamento e vice aparecem na página pública: o teto/limpeza é do
    // servidor (o formulário pode ser chamado direto, sem passar pela tela).
    const financiamento = normalizarFinanciamento(data.financiamento);
    if (!financiamento.ok) return financiamento;
    const vice = normalizarViceCoordenacao(data);
    if (!vice.ok) return vice;

    const slug = slugify(nome);
    const { adminEmails, ...dbData } = data;
    const projeto = await prisma.projeto.create({
      data: {
        nome: dbData.nome,
        slug,
        coordenador: dbData.coordenador,
        coordenadorEmail: dbData.coordenadorEmail?.trim().toLowerCase() || null,
        ...vice.valor,
        area: dbData.area,
        descricao: dbData.descricao ?? null,
        resumoCurto: dbData.resumoCurto ?? null,
        dataInicio: dbData.dataInicio ? new Date(dbData.dataInicio) : null,
        servidores: dbData.servidores ?? null,
        alunos: dbData.alunos ?? null,
        financiamento: financiamento.valor,
        observacao: dbData.observacao ?? null,
        status: dbData.status,
        logoUrl: dbData.logoUrl ?? null,
        bannerUrl: dbData.bannerUrl ?? null,
        corPrimaria: dbData.corPrimaria ?? '#2F52D3',
        email: dbData.email ?? null,
        instagram: dbData.instagram ?? null,
        site: dbData.site ?? null,
        destaque: dbData.destaque ?? false,
        formulario_extra: dbData.formularioExtra ?? [],
        // Mesma decisão do createEdital: sem fluxo de revisão no admin hoje,
        // deixar em RASCUNHO (default do schema) faz o projeto nunca aparecer
        // publicamente sem aviso nenhum.
        review_status: 'PUBLICADO',
      },
    });
    if (adminEmails !== undefined) {
      await syncProjectAdmins(projeto.id, adminEmails);
    }

    // Derivar eventos automaticamente
    await derivarEventosProjeto(projeto.id).catch(console.error);
    cache.invalidate('chat:');
    cache.invalidate('home:');
    await sincronizarProjetoSintetico(projeto.id).catch(console.error);

    return { ok: true, data: { id: projeto.id, slug: projeto.slug } };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

export async function updateProjeto(id: string, data: Partial<ProjetoFormData>, callerEmail: string): Promise<ActionResult> {
  try {
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    const { adminEmails } = data;

    // Create an explicit update payload to prevent mass assignment
    // and avoid Prisma rejecting unknown fields sent by the client.
    const updateData: any = {};
    if (data.nome !== undefined) {
      updateData.nome = data.nome;
      updateData.slug = slugify(data.nome);
    }
    if (data.coordenador !== undefined) updateData.coordenador = data.coordenador;
    if (data.coordenadorEmail !== undefined) updateData.coordenadorEmail = data.coordenadorEmail?.trim().toLowerCase() || null;
    if (data.viceCoordenadorNome !== undefined || data.viceCoordenadorEmail !== undefined) {
      const vice = normalizarViceCoordenacao(data);
      if (!vice.ok) return vice;
      // Só grava o que veio: mandar apenas o nome não pode apagar o e-mail do vice.
      if (data.viceCoordenadorNome !== undefined) updateData.viceCoordenadorNome = vice.valor.viceCoordenadorNome;
      if (data.viceCoordenadorEmail !== undefined) updateData.viceCoordenadorEmail = vice.valor.viceCoordenadorEmail;
    }
    if (data.area !== undefined) updateData.area = data.area;
    if (data.descricao !== undefined) updateData.descricao = data.descricao;
    if (data.descricao !== undefined) updateData.descricao = data.descricao;
    if (data.resumoCurto !== undefined) updateData.resumoCurto = data.resumoCurto;
    if (data.dataInicio !== undefined) updateData.dataInicio = data.dataInicio ? parseDataDoFormulario(data.dataInicio) : null;
    if (data.servidores !== undefined) updateData.servidores = data.servidores;
    if (data.alunos !== undefined) updateData.alunos = data.alunos;
    if (data.financiamento !== undefined) {
      const financiamento = normalizarFinanciamento(data.financiamento);
      if (!financiamento.ok) return financiamento;
      updateData.financiamento = financiamento.valor;
    }
    if (data.observacao !== undefined) updateData.observacao = data.observacao;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.logoUrl !== undefined) updateData.logoUrl = data.logoUrl;
    if (data.bannerUrl !== undefined) updateData.bannerUrl = data.bannerUrl;
    if (data.corPrimaria !== undefined) updateData.corPrimaria = data.corPrimaria;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.instagram !== undefined) updateData.instagram = data.instagram;
    if (data.site !== undefined) updateData.site = data.site;
    if (data.destaque !== undefined) updateData.destaque = data.destaque;
    if (data.formularioExtra !== undefined) updateData.formulario_extra = data.formularioExtra;

    await prisma.projeto.update({
      where: { id },
      data: updateData,
    });
    
    if (adminEmails !== undefined) {
      await syncProjectAdmins(id, adminEmails);
    }

    // Re-derivar eventos quando dados mudam
    await derivarEventosProjeto(id).catch(console.error);
    cache.invalidate('chat:');
    cache.invalidate('home:');
    await sincronizarProjetoSintetico(id).catch(console.error);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

/** Publica/despublica um projeto (ADMIN apenas) — alterna `review_status` entre PUBLICADO e RASCUNHO. */
export async function toggleProjetoPublicacao(id: string, callerEmail: string): Promise<ActionResult<{ review_status: string }>> {
  try {
    const caller = await prisma.user.findUnique({ where: { email: callerEmail }, select: { role: true } });
    if (caller?.role !== 'ADMIN') {
      return { ok: false, error: MENSAGENS.semPermissaoAdmin };
    }

    const projeto = await prisma.projeto.findUnique({ where: { id }, select: { review_status: true } });
    if (!projeto) return { ok: false, error: 'Não encontramos este projeto. Ele pode ter sido removido por outra pessoa.' };

    const review_status = projeto.review_status === 'PUBLICADO' ? 'RASCUNHO' : 'PUBLICADO';
    await prisma.projeto.update({ where: { id }, data: { review_status } });
    cache.invalidate('chat:');
    cache.invalidate('home:');
    await sincronizarProjetoSintetico(id).catch(console.error);

    return { ok: true, data: { review_status } };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

export async function deleteProjeto(id: string, callerEmail: string): Promise<ActionResult> {
  try {
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    const projetoAntes = await prisma.projeto.findUnique({
      where: { id },
      select: { coordenadorEmail: true, admins: { select: { email: true } } },
    });
    const emailsAfetados = [
      ...(projetoAntes?.coordenadorEmail ? [projetoAntes.coordenadorEmail] : []),
      ...(projetoAntes?.admins.map((a) => a.email) ?? []),
    ];

    await prisma.projeto.delete({ where: { id } });
    cache.invalidate('chat:');
    await removerProjetoSintetico(id);

    for (const email of emailsAfetados) {
      await revogarProfessorSeSemProjetos(email);
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

// ── Posts ─────────────────────────────────────────────────────────────────────

export type PostFormData = {
  titulo: string;
  conteudo: string;
  resumo?: string;
  imagemUrl?: string;
  videoUrl?: string;
  arquivoPdfUrl?: string;
  linkExterno?: string;
  /** Chave do ícone de capa (catálogo em src/lib/post-capa.ts). */
  icone?: string | null;
  status: StatusPost;
  projetoId: string;
  /** Anexos (PDF, ZIP, RAR) já enviados para o storage local do servidor. */
  anexos?: unknown;
  /**
   * Post feito de um arquivo .html (src/lib/post-documento-html.ts) — mesma
   * regra do painel do professor: `undefined` mantém, `null` remove.
   */
  documentoHtml?: DocumentoHtmlRecebido | null;
};

export async function listPosts(userEmail?: string, userRole?: string) {
  const where = userRole === 'PROFESSOR' && userEmail 
    ? { projeto: { admins: { some: { email: userEmail } } } } 
    : {};
  return prisma.post.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      projeto: { select: { nome: true, slug: true } },
      author: { select: { name: true } },
      // Só o resumo: o documento em si é buscado ao editar (`getDocumentoHtmlDoPost`).
      documentoHtml: { select: { nomeArquivo: true, bytes: true } },
    },
  });
}

/** Documento HTML de um post, para a pré-visualização ao editar no painel do admin. */
export async function getDocumentoHtmlDoPost(postId: string, userEmail: string): Promise<ActionResult<{ html: string; nomeArquivo: string | null; bytes: number } | null>> {
  try {
    const userRecord = await prisma.user.findUnique({ where: { email: userEmail }, select: { role: true } });
    if (!userRecord) return { ok: false, error: MENSAGENS.usuarioNaoEncontrado };

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { projetoId: true, documentoHtml: { select: { html: true, nomeArquivo: true, bytes: true } } },
    });
    if (!post) return { ok: false, error: 'Não encontramos esta publicação. Ela pode ter sido removida por outra pessoa.' };

    // Mesma régua de `updatePost`: quem pode editar o post pode ver o documento.
    if (userRecord.role === 'PROFESSOR') {
      if (!(await isCoordenadorOuViceDoProjeto(post.projetoId, userEmail))) return { ok: false, error: MENSAGENS.semPermissaoCoordenador };
    } else if (userRecord.role !== 'ADMIN') {
      return { ok: false, error: MENSAGENS.semPermissao };
    }

    return { ok: true, data: post.documentoHtml };
  } catch (e) {
    return { ok: false, error: mensagemAmigavel(e, MENSAGENS.operacaoNaoConcluida) };
  }
}

export async function createPost(data: PostFormData, authorEmail: string): Promise<ActionResult<{ id: string }>> {
  try {
    // Role sempre lido do servidor — nunca confiar num `userRole` vindo do
    // cliente. Antes desta correção, quando `userRecord` era `null` (email
    // inexistente/não autenticado), a checagem inteira caía pro fallback
    // `userRole` fornecido pelo cliente — bastava mandar `userRole: 'ADMIN'`
    // pra pular a checagem de coordenador (mesma classe do achado S2).
    const userRecord = await prisma.user.findUnique({ where: { email: authorEmail }, select: { role: true } });
    if (!userRecord) return { ok: false, error: MENSAGENS.usuarioNaoEncontrado };

    if (userRecord.role === 'PROFESSOR') {
      const isCoordinator = await isCoordenadorOuViceDoProjeto(data.projetoId, authorEmail);
      if (!isCoordinator) return { ok: false, error: MENSAGENS.semPermissaoCoordenador };
    } else if (userRecord.role !== 'ADMIN') {
      return { ok: false, error: MENSAGENS.semPermissao };
    }

    const author = await ensureUser(authorEmail);
    // Mesmo formato do painel do professor: o sufixo curto evita que dois posts
    // com o MESMO título colidam no `slug` (que é único no banco) — antes, criar
    // o segundo post com um título repetido devolvia erro de banco genérico.
    const slug = `${slugify(data.titulo)}-${Date.now().toString(36)}`;
    // Post de documento HTML: o texto do post sai do próprio documento.
    const documento = data.documentoHtml ? validarDocumentoHtml(data.documentoHtml) : null;
    if (documento && !documento.ok) return documento;
    const conteudo = sanitizeHtml(documento ? documento.valor.conteudo : data.conteudo);

    const erroCapa = erroDeUrlDeCapa(data.imagemUrl);
    if (erroCapa) return { ok: false, error: erroCapa };

    // Mesmo orçamento do painel do professor (20 MB por post, somando imagens do
    // texto + anexos). Sem isto, um post criado pelo admin escaparia do limite.
    const midias = await validarMidiasDoPost(conteudo, data.anexos);
    if (!midias.ok) return { ok: false, error: midias.error };

    const post = await prisma.post.create({
      data: {
        titulo: data.titulo,
        slug,
        conteudo,
        resumo: data.resumo ?? null,
        imagemUrl: data.imagemUrl ?? null,
        videoUrl: data.videoUrl ?? null,
        arquivoPdfUrl: data.arquivoPdfUrl ?? null,
        linkExterno: data.linkExterno ?? null,
        icone: chaveDeIconeValida(data.icone) ? data.icone : null,
        anexos: midias.anexos as unknown as Prisma.InputJsonValue,
        status: data.status,
        projetoId: data.projetoId,
        authorId: author.id,
        ...(documento ? {
          documentoHtml: {
            create: { html: documento.valor.html, nomeArquivo: documento.valor.nomeArquivo, bytes: documento.valor.bytes },
          },
        } : {}),
      },
    });
    return { ok: true, data: { id: post.id } };
  } catch (e) {
    return { ok: false, error: translatePrismaError(e) };
  }
}

export async function updatePost(id: string, data: Partial<PostFormData>, userEmail: string): Promise<ActionResult> {
  try {
    // Role sempre lido do servidor — ver comentário em createPost.
    const userRecord = await prisma.user.findUnique({ where: { email: userEmail }, select: { role: true } });
    if (!userRecord) return { ok: false, error: MENSAGENS.usuarioNaoEncontrado };

    // Estado atual: o conteúdo pode não vir nesta chamada (update parcial), e o
    // orçamento precisa considerar o que JÁ está publicado + o que está entrando.
    // `projetoId` também é lido aqui para validar a troca de projeto.
    const atual = await prisma.post.findUnique({
      where: { id },
      select: { projetoId: true, conteudo: true, anexos: true },
    });
    if (!atual) return { ok: false, error: 'Não encontramos esta publicação. Ela pode ter sido removida por outra pessoa.' };

    if (userRecord.role === 'PROFESSOR') {
      const isCoordinator = await isCoordenadorOuViceDoProjeto(atual.projetoId, userEmail);
      if (!isCoordinator) return { ok: false, error: MENSAGENS.semPermissaoCoordenador };
    } else if (userRecord.role !== 'ADMIN') {
      return { ok: false, error: MENSAGENS.semPermissao };
    }

    // Mover post entre projetos é permitido — o formulário do admin já oferece
    // o select. A checagem é feita nos DOIS lados: o professor precisa
    // coordenar o projeto atual (acima) e também o projeto de destino. Sem
    // isso, um coordenador poderia jogar uma publicação em projeto alheio.
    const projetoDestino = data.projetoId?.trim();
    if (data.projetoId !== undefined) {
      if (!projetoDestino) {
        return { ok: false, error: 'Escolha o projeto que vai receber esta publicação.' };
      }

      if (projetoDestino !== atual.projetoId) {
        const destino = await prisma.projeto.findUnique({
          where: { id: projetoDestino },
          select: { id: true },
        });
        if (!destino) {
          return { ok: false, error: 'O projeto de destino não existe mais. Atualize a página e escolha outro.' };
        }

        if (
          userRecord.role === 'PROFESSOR' &&
          !(await isCoordenadorOuViceDoProjeto(projetoDestino, userEmail))
        ) {
          return { ok: false, error: 'Você só pode mover a publicação para um projeto que coordena.' };
        }
      }
    }

    const documento = data.documentoHtml ? validarDocumentoHtml(data.documentoHtml) : null;
    if (documento && !documento.ok) return documento;
    const dadosDocumento = documento
      ? { html: documento.valor.html, nomeArquivo: documento.valor.nomeArquivo, bytes: documento.valor.bytes }
      : null;

    // Documento novo traz o próprio texto; senão vale o que veio do editor.
    const conteudoEntrada = documento ? documento.valor.conteudo : data.conteudo;
    const conteudoFinal = conteudoEntrada !== undefined ? sanitizeHtml(conteudoEntrada) : atual.conteudo;
    const anexosEntrada = data.anexos !== undefined ? data.anexos : atual.anexos;

    if (data.imagemUrl !== undefined) {
      const erroCapa = erroDeUrlDeCapa(data.imagemUrl);
      if (erroCapa) return { ok: false, error: erroCapa };
    }

    // Mesmo orçamento do painel do professor (20 MB por post).
    const midias = await validarMidiasDoPost(conteudoFinal, anexosEntrada);
    if (!midias.ok) return { ok: false, error: midias.error };

    // Campos gravados EXPLICITAMENTE. Antes era `...data`, que espalhava no
    // Prisma qualquer chave que o cliente mandasse — inclusive `authorId`.
    // `projetoId` agora é aceito, mas passou pela validação de destino acima.
    //
    // O `slug` NÃO entra: ele é a URL pública do post (a que o botão "Ver no
    // portal" abre e a que já foi compartilhada com os estudantes) e é gerado uma
    // única vez, na criação, com sufixo que evita colisão entre títulos iguais.
    // Regerar no update trocava o endereço a cada edição e podia colidir com
    // outro post de mesmo título (o `slug` é único no banco).
    await prisma.post.update({
      where: { id },
      data: {
        ...(data.titulo !== undefined ? { titulo: data.titulo } : {}),
        ...(conteudoEntrada !== undefined ? { conteudo: conteudoFinal } : {}),
        ...(data.resumo !== undefined ? { resumo: data.resumo ?? null } : {}),
        ...(data.imagemUrl !== undefined ? { imagemUrl: data.imagemUrl ?? null } : {}),
        ...(data.videoUrl !== undefined ? { videoUrl: data.videoUrl ?? null } : {}),
        ...(data.arquivoPdfUrl !== undefined ? { arquivoPdfUrl: data.arquivoPdfUrl ?? null } : {}),
        ...(data.linkExterno !== undefined ? { linkExterno: data.linkExterno ?? null } : {}),
        ...(data.icone !== undefined ? { icone: chaveDeIconeValida(data.icone) ? data.icone : null } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(projetoDestino ? { projetoId: projetoDestino } : {}),
        anexos: midias.anexos as unknown as Prisma.InputJsonValue,
        ...(dadosDocumento ? { documentoHtml: { upsert: { create: dadosDocumento, update: dadosDocumento } } } : {}),
      },
    });

    // `null` = voltou para o editor: o post passa a ser só texto. `deleteMany`
    // não falha quando o post nunca teve documento.
    if (data.documentoHtml === null) {
      await prisma.postDocumentoHtml.deleteMany({ where: { postId: id } });
    }

    await limparAnexosRemovidos(atual.anexos, midias.anexos);
    return { ok: true };  } catch (e) {
    return { ok: false, error: mensagemAmigavel(e, MENSAGENS.operacaoNaoConcluida) };
  }
}

export async function deletePost(id: string, userEmail: string): Promise<ActionResult> {
  try {
    // Role sempre lido do servidor — ver comentário em createPost.
    const userRecord = await prisma.user.findUnique({ where: { email: userEmail }, select: { role: true } });
    if (!userRecord) return { ok: false, error: MENSAGENS.usuarioNaoEncontrado };

    if (userRecord.role === 'PROFESSOR') {
      const post = await prisma.post.findUnique({ where: { id }, select: { projetoId: true } });
      if (!post) return { ok: false, error: 'Não encontramos esta publicação. Ela pode ter sido removida por outra pessoa.' };
      const isCoordinator = await isCoordenadorOuViceDoProjeto(post.projetoId, userEmail);
      if (!isCoordinator) return { ok: false, error: MENSAGENS.semPermissaoCoordenador };
    } else if (userRecord.role !== 'ADMIN') {
      return { ok: false, error: MENSAGENS.semPermissao };
    }

    await prisma.post.delete({ where: { id } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mensagemAmigavel(e, MENSAGENS.operacaoNaoConcluida) };
  }
}

// ── Eventos ───────────────────────────────────────────────────────────────────

export type EventoFormData = {
  titulo: string;
  descricao?: string;
  data: string;
  dataFim?: string;
  tipo: TipoEvento;
  local?: string;
  linkInscr?: string;
  editalSlug?: string;
};

export async function listEventos() {
  return prisma.evento.findMany({ orderBy: { data: 'asc' } });
}

export async function createEvento(data: EventoFormData, authorEmail: string): Promise<ActionResult<{ id: string }>> {
  try {
    const auth = await requireAdminEmail(authorEmail);
    if (!auth.ok) return auth;

    // Server-side validation
    const titulo = data.titulo?.trim();
    if (!titulo || titulo.length < 2) {
      return { ok: false, error: MENSAGENS.campoObrigatorio('Título do evento') };
    }
    if (!data.data) {
      return { ok: false, error: MENSAGENS.campoObrigatorio('Data do evento') };
    }

    const author = await ensureUser(authorEmail);
    const evento = await prisma.evento.create({
      data: {
        titulo: data.titulo,
        descricao: data.descricao ?? null,
        data: parseDataDoFormulario(data.data) as Date,
        dataFim: data.dataFim ? parseDataDoFormulario(data.dataFim) : null,
        tipo: data.tipo,
        local: data.local ?? null,
        linkInscr: data.linkInscr ?? null,
        editalSlug: data.editalSlug ?? null,
        authorId: author.id,
      },
    });
    return { ok: true, data: { id: evento.id } };
  } catch (e) {
    return { ok: false, error: mensagemAmigavel(e, MENSAGENS.operacaoNaoConcluida) };
  }
}

export async function updateEvento(id: string, data: Partial<EventoFormData>, callerEmail: string): Promise<ActionResult> {
  try {
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    await prisma.evento.update({
      where: { id },
      data: {
        ...data,
        data: data.data ? parseDataDoFormulario(data.data) ?? undefined : undefined,
        dataFim: data.dataFim ? parseDataDoFormulario(data.dataFim) ?? undefined : undefined,
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mensagemAmigavel(e, MENSAGENS.operacaoNaoConcluida) };
  }
}

export async function deleteEvento(id: string, callerEmail: string): Promise<ActionResult> {
  try {
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    await prisma.evento.delete({ where: { id } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mensagemAmigavel(e, MENSAGENS.operacaoNaoConcluida) };
  }
}

// ── Usuários (master only) ────────────────────────────────────────────────────

export async function listUsuarios() {
  return prisma.user.findMany({ 
    orderBy: { createdAt: 'desc' },
    include: {
      projetosAdmin: { select: { id: true, nome: true } },
      // A tela mostra quem foi promovido pelo e-mail mestre (o papel ADMIN
      // sozinho também vale para o próprio mestre, que não tem permission).
      permissions: {
        where: { permission: PERMISSAO_ADMIN_GERAL },
        select: { id: true },
      },
    }
  });
}

export async function updateUserRole(userId: string, role: UserRole, projetoId: string | undefined, callerEmail: string): Promise<ActionResult> {
  try {
    // Antes só protegia contra auto-promoção (e só se `callerEmail` fosse
    // passado — era opcional, então omiti-lo pulava até essa checagem).
    // Não existia NENHUMA verificação de que o chamador é admin — qualquer
    // chamada direta promovia qualquer usuário a ADMIN.
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    // Gerenciar usuários é exclusivo do e-mail mestre. Um Administrador Geral
    // promovido pode usar o restante do painel, mas NÃO pode criar outro admin
    // (nem mudar papéis) — era exatamente a restrição pedida.
    if (!isAdministradorGeral(callerEmail)) {
      return { ok: false, error: MENSAGENS.semPermissaoAdminGeral };
    }

    const caller = await prisma.user.findUnique({ where: { email: callerEmail }, select: { id: true } });
    if (caller && caller.id === userId) {
      return { ok: false, error: 'Você não pode alterar o seu próprio nível de acesso.' };
    }

    if (role === 'PROFESSOR' && !projetoId) {
      return { ok: false, error: 'Escolha a qual projeto este professor ficará vinculado.' };
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, role: true },
    });
    if (!target) return { ok: false, error: 'Usuário não encontrado.' };

    if (role === 'ADMIN') {
      // O e-mail mestre já é ADMIN por configuração; qualquer outro passa a ser
      // Administrador Geral via permissão explícita `admin_geral`.
      if (!isAdministradorGeral(target.email)) {
        await prisma.userPermission.upsert({
          where: { user_id_permission: { user_id: userId, permission: PERMISSAO_ADMIN_GERAL } },
          update: { granted_by: caller?.id ?? null },
          create: { user_id: userId, permission: PERMISSAO_ADMIN_GERAL, granted_by: caller?.id ?? null },
        });
      }
      await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
      return { ok: true };
    }

    // Rebaixar o e-mail mestre é proibido. Para os demais, sair de ADMIN
    // remove a permissão que sustentava o papel (o próximo login recalcula).
    if (isAdministradorGeral(target.email)) {
      return { ok: false, error: 'O Administrador Geral definido na configuração do sistema não pode ser rebaixado por aqui.' };
    }
    await prisma.userPermission.deleteMany({
      where: { user_id: userId, permission: PERMISSAO_ADMIN_GERAL },
    });

    await prisma.user.update({ where: { id: userId }, data: { role } });

    if (role === 'PROFESSOR' && projetoId) {
      await prisma.projeto.update({
        where: { id: projetoId },
        data: {
          admins: {
            connect: { id: userId }
          }
        }
      });
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: mensagemAmigavel(e, MENSAGENS.operacaoNaoConcluida) };
  }
}

export async function deleteUser(userId: string, callerEmail: string): Promise<ActionResult> {
  try {
    // Mesmo problema de updateUserRole: sem checagem de que o chamador é
    // admin, só uma auto-proteção que podia ser pulada omitindo o parâmetro.
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    if (!isAdministradorGeral(callerEmail)) {
      return { ok: false, error: MENSAGENS.semPermissaoAdminGeral };
    }

    const caller = await prisma.user.findUnique({ where: { email: callerEmail }, select: { id: true } });
    if (caller && caller.id === userId) {
      return { ok: false, error: 'Você não pode excluir a sua própria conta enquanto está logado nela.' };
    }

    const alvo = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (alvo && isAdministradorGeral(alvo.email)) {
      return { ok: false, error: 'O Administrador Geral definido na configuração do sistema não pode ser excluído.' };
    }

    await prisma.user.delete({ where: { id: userId } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mensagemAmigavel(e, MENSAGENS.operacaoNaoConcluida) };
  }
}

export async function inviteUser(email: string, role: UserRole, projetoId: string | undefined, callerEmail: string): Promise<ActionResult> {
  try {
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    if (!isAdministradorGeral(callerEmail)) {
      return { ok: false, error: MENSAGENS.semPermissaoAdminGeral };
    }

    if (role === 'PROFESSOR' && !projetoId) {
      return { ok: false, error: 'Escolha a qual projeto este professor ficará vinculado.' };
    }

    const user = await prisma.user.upsert({
      where: { email },
      update: { role },
      create: { email, name: email, role },
    });

    if (role === 'ADMIN' && !isAdministradorGeral(email)) {
      // Convite com nível ADMIN cria a permissão que sustenta o papel.
      await prisma.userPermission.upsert({
        where: { user_id_permission: { user_id: user.id, permission: PERMISSAO_ADMIN_GERAL } },
        update: {},
        create: { user_id: user.id, permission: PERMISSAO_ADMIN_GERAL },
      });
    } else if (role !== 'ADMIN') {
      // Rebaixar pelo convite também precisa remover a permissão; sem isso o
      // próximo login recalcularia o papel e devolveria ADMIN.
      await prisma.userPermission.deleteMany({
        where: { user_id: user.id, permission: PERMISSAO_ADMIN_GERAL },
      });
    }

    if (role === 'PROFESSOR' && projetoId) {
      await prisma.projeto.update({
        where: { id: projetoId },
        data: {
          admins: {
            connect: { id: user.id }
          }
        }
      });
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: mensagemAmigavel(e, MENSAGENS.operacaoNaoConcluida) };
  }
}

// ── Limpeza de banco (master only) ──────────────────────────────────────────

export async function getLimpezaStats(): Promise<Record<string, number>> {
  const stats: Record<string, number> = {};
  for (const table of LIMPEZA_TABLES) {
    try {
      stats[table.key] = await (prisma as any)[table.model].count();
    } catch {
      stats[table.key] = 0;
    }
  }
  return stats;
}

export async function limparTabelas(
  tables: string[],
  confirmEmail: string
): Promise<ActionResult<{ deleted: Record<string, number> }>> {
  try {
    if (!MASTER_ADMIN_EMAIL) {
      return {
        ok: false,
        error: 'A limpeza de dados está desativada porque o Administrador Geral não está configurado no ambiente. Fale com a equipe técnica do portal.',
      };
    }
    if (confirmEmail !== MASTER_ADMIN_EMAIL) {
      return { ok: false, error: 'O e-mail de confirmação digitado não confere. Digite exatamente o e-mail do Administrador Geral.' };
    }

    const deleted: Record<string, number> = {};
    const validTables = LIMPEZA_TABLES.filter((t) => tables.includes(t.key));

    for (const table of validTables) {
      try {
        const result = await (prisma as any)[table.model].deleteMany({});
        deleted[table.key] = result.count;
      } catch (e) {
        deleted[table.key] = -1;
      }
    }

    cache.invalidate('chat:');

    return { ok: true, data: { deleted } };
  } catch (e) {
    return { ok: false, error: mensagemAmigavel(e, MENSAGENS.operacaoNaoConcluida) };
  }
}

// RAG legado (RagDocumento/RagChunk) removido daqui em 2026-08-26: eram
// funções mortas (nenhuma página chamava), sem nenhuma checagem de
// autorização, operando em tabelas já substituídas por documentos_kb/
// chunks_kb (ver src/actions/rag.ts) desde a Etapa 2 do plano RAG.
