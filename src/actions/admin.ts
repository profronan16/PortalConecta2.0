'use server';

import { prisma } from '@/lib/prisma';
import { slugify, translatePrismaError } from '@/lib/utils';
import { cache } from '@/lib/cache';
import { derivarEventosEdital, derivarEventosProjeto } from '@/lib/evento-helpers';
import { LIMPEZA_TABLES } from '@/lib/limpeza-tables';
import { sincronizarProjetoSintetico, removerProjetoSintetico } from '@/lib/projeto-sintetico';
import { sanitizeHtml } from '@/lib/rich-text';
import type { PerguntaExtra } from '@/lib/formulario-extra';
import {
  isAdministradorGeral,
  isCoordenadorOuViceDoProjeto,
  resolveUserRole,
  usuarioTemAlgumProjeto,
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
 */
async function requireAdminEmail(email?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!email) return { ok: false, error: 'Não autenticado' };
  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  if (user?.role !== 'ADMIN') return { ok: false, error: 'Acesso negado: apenas administradores' };
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

export async function ensureUser(email: string, name?: string): Promise<{ id: string; role: UserRole }> {
  const user = await prisma.user.upsert({
    where: { email },
    update: name ? { name } : {},
    create: { email, name: name ?? email, role: 'ESTUDANTE' },
  });
  // Recalcula o papel ao vivo (ver getUserRole) para que o AuthContext do
  // cliente já receba ADMIN/PROFESSOR corretos no primeiro login, em vez do
  // ESTUDANTE default do upsert acima.
  const role = (await resolveUserRole(email)) ?? user.role;
  return { id: user.id, role };
}

// ── Dashboard stats ───────────────────────────────────────────────────────────

export async function getDashboardStats() {
  const [editaisAtivos, projetos, usuarios, eventos] = await Promise.all([
    prisma.edital.count({ where: { status: { in: ['ABERTO', 'EM_ANALISE'] } } }),
    prisma.projeto.count({ where: { status: 'EM_EXECUCAO' } }),
    prisma.user.count(),
    prisma.evento.count({ where: { data: { gte: new Date() } } }),
  ]);
  return { editaisAtivos, projetos, usuarios, eventos };
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
      return { ok: false, error: 'Título do edital é obrigatório (mínimo 2 caracteres)' };
    }
    if (!resumo) {
      return { ok: false, error: 'Resumo é obrigatório' };
    }
    if (!data.dataEncerramento) {
      return { ok: false, error: 'Data de encerramento é obrigatória' };
    }
    if (!data.linkOficial?.trim()) {
      return { ok: false, error: 'Link oficial é obrigatório' };
    }

    const author = await ensureUser(authorEmail);
    const slug = slugify(data.titulo);
    const edital = await prisma.edital.create({
      data: {
        titulo: data.titulo,
        slug,
        categoria: data.categoria,
        resumo: data.resumo,
        dataEncerramento: new Date(data.dataEncerramento),
        status: data.status,
        linkOficial: data.linkOficial,
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
        dataEncerramento: data.dataEncerramento ? new Date(data.dataEncerramento) : undefined,
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
      return { ok: false, error: 'Acesso negado: apenas administradores podem publicar/despublicar' };
    }

    const edital = await prisma.edital.findUnique({ where: { id }, select: { review_status: true } });
    if (!edital) return { ok: false, error: 'Edital não encontrado' };

    const review_status = edital.review_status === 'PUBLICADO' ? 'RASCUNHO' : 'PUBLICADO';
    await prisma.edital.update({ where: { id }, data: { review_status } });
    cache.invalidate('chat:');

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
  dataInicio?: string;
  servidores?: string;
  alunos?: string;
  observacao?: string;
  status: StatusProjeto;
  logoUrl?: string;
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
      return { ok: false, error: 'Nome do projeto é obrigatório (mínimo 2 caracteres)' };
    }
    if (!coordenador) {
      return { ok: false, error: 'Coordenador é obrigatório' };
    }
    if (!area) {
      return { ok: false, error: 'Área é obrigatória' };
    }

    const slug = slugify(nome);
    const { adminEmails, ...dbData } = data;
    const projeto = await prisma.projeto.create({
      data: {
        nome: dbData.nome,
        slug,
        coordenador: dbData.coordenador,
        coordenadorEmail: dbData.coordenadorEmail?.trim().toLowerCase() || null,
        viceCoordenadorNome: dbData.viceCoordenadorNome?.trim() || null,
        viceCoordenadorEmail: dbData.viceCoordenadorEmail?.trim().toLowerCase() || null,
        area: dbData.area,
        descricao: dbData.descricao ?? null,
        dataInicio: dbData.dataInicio ? new Date(dbData.dataInicio) : null,
        servidores: dbData.servidores ?? null,
        alunos: dbData.alunos ?? null,
        observacao: dbData.observacao ?? null,
        status: dbData.status,
        logoUrl: dbData.logoUrl ?? null,
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
    if (data.viceCoordenadorNome !== undefined) updateData.viceCoordenadorNome = data.viceCoordenadorNome?.trim() || null;
    if (data.viceCoordenadorEmail !== undefined) updateData.viceCoordenadorEmail = data.viceCoordenadorEmail?.trim().toLowerCase() || null;
    if (data.area !== undefined) updateData.area = data.area;
    if (data.descricao !== undefined) updateData.descricao = data.descricao;
    if (data.dataInicio !== undefined) updateData.dataInicio = data.dataInicio ? new Date(data.dataInicio) : null;
    if (data.servidores !== undefined) updateData.servidores = data.servidores;
    if (data.alunos !== undefined) updateData.alunos = data.alunos;
    if (data.observacao !== undefined) updateData.observacao = data.observacao;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.logoUrl !== undefined) updateData.logoUrl = data.logoUrl;
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
      return { ok: false, error: 'Acesso negado: apenas administradores podem publicar/despublicar' };
    }

    const projeto = await prisma.projeto.findUnique({ where: { id }, select: { review_status: true } });
    if (!projeto) return { ok: false, error: 'Projeto não encontrado' };

    const review_status = projeto.review_status === 'PUBLICADO' ? 'RASCUNHO' : 'PUBLICADO';
    await prisma.projeto.update({ where: { id }, data: { review_status } });
    cache.invalidate('chat:');
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
  status: StatusPost;
  projetoId: string;
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
    },
  });
}

export async function createPost(data: PostFormData, authorEmail: string): Promise<ActionResult<{ id: string }>> {
  try {
    // Role sempre lido do servidor — nunca confiar num `userRole` vindo do
    // cliente. Antes desta correção, quando `userRecord` era `null` (email
    // inexistente/não autenticado), a checagem inteira caía pro fallback
    // `userRole` fornecido pelo cliente — bastava mandar `userRole: 'ADMIN'`
    // pra pular a checagem de coordenador (mesma classe do achado S2).
    const userRecord = await prisma.user.findUnique({ where: { email: authorEmail }, select: { role: true } });
    if (!userRecord) return { ok: false, error: 'Usuário não encontrado' };

    if (userRecord.role === 'PROFESSOR') {
      const isCoordinator = await isCoordenadorOuViceDoProjeto(data.projetoId, authorEmail);
      if (!isCoordinator) return { ok: false, error: 'Acesso negado: você não é coordenador deste projeto' };
    } else if (userRecord.role !== 'ADMIN') {
      return { ok: false, error: 'Acesso negado' };
    }

    const author = await ensureUser(authorEmail);
    const slug = slugify(data.titulo);
    const post = await prisma.post.create({
      data: {
        titulo: data.titulo,
        slug,
        conteudo: sanitizeHtml(data.conteudo),
        resumo: data.resumo ?? null,
        imagemUrl: data.imagemUrl ?? null,
        videoUrl: data.videoUrl ?? null,
        arquivoPdfUrl: data.arquivoPdfUrl ?? null,
        linkExterno: data.linkExterno ?? null,
        status: data.status,
        projetoId: data.projetoId,
        authorId: author.id,
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
    if (!userRecord) return { ok: false, error: 'Usuário não encontrado' };

    if (userRecord.role === 'PROFESSOR') {
      const post = await prisma.post.findUnique({ where: { id }, select: { projetoId: true } });
      if (!post) return { ok: false, error: 'Post não encontrado' };
      const isCoordinator = await isCoordenadorOuViceDoProjeto(post.projetoId, userEmail);
      if (!isCoordinator) return { ok: false, error: 'Acesso negado: você não é coordenador do projeto deste post' };
    } else if (userRecord.role !== 'ADMIN') {
      return { ok: false, error: 'Acesso negado' };
    }

    await prisma.post.update({
      where: { id },
      data: {
        ...data,
        conteudo: data.conteudo !== undefined ? sanitizeHtml(data.conteudo) : undefined,
        slug: data.titulo ? slugify(data.titulo) : undefined,
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deletePost(id: string, userEmail: string): Promise<ActionResult> {
  try {
    // Role sempre lido do servidor — ver comentário em createPost.
    const userRecord = await prisma.user.findUnique({ where: { email: userEmail }, select: { role: true } });
    if (!userRecord) return { ok: false, error: 'Usuário não encontrado' };

    if (userRecord.role === 'PROFESSOR') {
      const post = await prisma.post.findUnique({ where: { id }, select: { projetoId: true } });
      if (!post) return { ok: false, error: 'Post não encontrado' };
      const isCoordinator = await isCoordenadorOuViceDoProjeto(post.projetoId, userEmail);
      if (!isCoordinator) return { ok: false, error: 'Acesso negado: você não é coordenador do projeto deste post' };
    } else if (userRecord.role !== 'ADMIN') {
      return { ok: false, error: 'Acesso negado' };
    }

    await prisma.post.delete({ where: { id } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
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
      return { ok: false, error: 'Título do evento é obrigatório (mínimo 2 caracteres)' };
    }
    if (!data.data) {
      return { ok: false, error: 'Data do evento é obrigatória' };
    }

    const author = await ensureUser(authorEmail);
    const evento = await prisma.evento.create({
      data: {
        titulo: data.titulo,
        descricao: data.descricao ?? null,
        data: new Date(data.data),
        dataFim: data.dataFim ? new Date(data.dataFim) : null,
        tipo: data.tipo,
        local: data.local ?? null,
        linkInscr: data.linkInscr ?? null,
        editalSlug: data.editalSlug ?? null,
        authorId: author.id,
      },
    });
    return { ok: true, data: { id: evento.id } };
  } catch (e) {
    return { ok: false, error: String(e) };
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
        data: data.data ? new Date(data.data) : undefined,
        dataFim: data.dataFim ? new Date(data.dataFim) : undefined,
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteEvento(id: string, callerEmail: string): Promise<ActionResult> {
  try {
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    await prisma.evento.delete({ where: { id } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ── Usuários (master only) ────────────────────────────────────────────────────

export async function listUsuarios() {
  return prisma.user.findMany({ 
    orderBy: { createdAt: 'desc' },
    include: { projetosAdmin: { select: { id: true, nome: true } } }
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

    const caller = await prisma.user.findUnique({ where: { email: callerEmail }, select: { id: true } });
    if (caller && caller.id === userId) {
      return { ok: false, error: 'Você não pode alterar seu próprio papel.' };
    }

    if (role === 'PROFESSOR' && !projetoId) {
      return { ok: false, error: 'Um projeto deve ser selecionado para o Professor.' };
    }

    // Só existe um Administrador Geral (ADMIN_EMAILS) — ninguém mais pode
    // virar ADMIN por aqui, mesmo sendo o próprio Administrador Geral quem
    // chamou a action. Sem essa checagem, o painel de Usuários permitia criar
    // administradores adicionais, contrariando o modelo de "um só Admin Geral
    // + professores restritos aos próprios projetos".
    if (role === 'ADMIN') {
      const target = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!target || !isAdministradorGeral(target.email)) {
        return { ok: false, error: 'Só existe um Administrador Geral, definido em ADMIN_EMAILS — não é possível promover outro usuário a Administrador.' };
      }
    }

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
    return { ok: false, error: String(e) };
  }
}

export async function deleteUser(userId: string, callerEmail: string): Promise<ActionResult> {
  try {
    // Mesmo problema de updateUserRole: sem checagem de que o chamador é
    // admin, só uma auto-proteção que podia ser pulada omitindo o parâmetro.
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    const caller = await prisma.user.findUnique({ where: { email: callerEmail }, select: { id: true } });
    if (caller && caller.id === userId) {
      return { ok: false, error: 'Você não pode excluir sua própria conta.' };
    }

    await prisma.user.delete({ where: { id: userId } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function inviteUser(email: string, role: UserRole, projetoId: string | undefined, callerEmail: string): Promise<ActionResult> {
  try {
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    if (role === 'PROFESSOR' && !projetoId) {
      return { ok: false, error: 'Um projeto deve ser selecionado para o Professor.' };
    }

    // Mesma regra de updateUserRole: só o Administrador Geral (ADMIN_EMAILS) pode ser ADMIN.
    if (role === 'ADMIN' && !isAdministradorGeral(email)) {
      return { ok: false, error: 'Só existe um Administrador Geral, definido em ADMIN_EMAILS — não é possível convidar outro usuário como Administrador.' };
    }

    const user = await prisma.user.upsert({
      where: { email },
      update: { role },
      create: { email, name: email, role },
    });

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
    return { ok: false, error: String(e) };
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
      return { ok: false, error: 'ADMIN_EMAILS não configurado. Limpeza indisponível.' };
    }
    if (confirmEmail !== MASTER_ADMIN_EMAIL) {
      return { ok: false, error: 'Email de confirmação não confere' };
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
    return { ok: false, error: String(e) };
  }
}

// RAG legado (RagDocumento/RagChunk) removido daqui em 2026-08-26: eram
// funções mortas (nenhuma página chamava), sem nenhuma checagem de
// autorização, operando em tabelas já substituídas por documentos_kb/
// chunks_kb (ver src/actions/rag.ts) desde a Etapa 2 do plano RAG.
