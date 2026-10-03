'use server';

import { prisma } from '@/lib/prisma';
import { createHash } from 'crypto';
import { chunkDocument } from '@/lib/chunking';
import { deactivateOldDocumentVersions } from '@/lib/busca-vetorial';
import { curarDocumentoKb } from '@/lib/kb-worker';
import { indexarDocumentoKb } from '@/lib/indexador';

type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

async function requireAdminEmail(email?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!email) return { ok: false, error: 'Não autenticado' };
  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  if (user?.role !== 'ADMIN') return { ok: false, error: 'Acesso negado: apenas administradores' };
  return { ok: true };
}

export async function listDocumentosKb(callerEmail?: string) {
  const auth = await requireAdminEmail(callerEmail);
  if (!auth.ok) return auth;

  const docs = await prisma.documentoKb.findMany({ orderBy: { createdAt: 'desc' } });
  return { ok: true, data: docs } as const;
}

export async function getDocumentoKbDetail(id: string, callerEmail?: string) {
  const auth = await requireAdminEmail(callerEmail);
  if (!auth.ok) return auth;

  const doc = await prisma.documentoKb.findUnique({
    where: { id },
    include: { chunks: { orderBy: { chunkIndex: 'asc' } } },
  });
  if (!doc) return { ok: false, error: 'Documento não encontrado' } as const;
  return { ok: true, data: doc } as const;
}

export async function createDocumentoKbFromText(
  data: { titulo: string; conteudo: string; tipo: string },
  callerEmail?: string
): Promise<ActionResult<{ id: string; chunks: number }>> {
  const auth = await requireAdminEmail(callerEmail);
  if (!auth.ok) return auth;

  try {
    const titulo = data.titulo?.trim();
    const conteudo = data.conteudo?.trim();
    if (!titulo) return { ok: false, error: 'Título é obrigatório' };
    if (!conteudo) return { ok: false, error: 'Conteúdo é obrigatório' };

    const hashArquivo = createHash('sha256').update(conteudo).digest('hex');
    const existenteAtivo = await prisma.documentoKb.findFirst({ where: { hashArquivo, ativo: true } });
    if (existenteAtivo) {
      return { ok: false, error: 'Já existe um documento ativo com este conteúdo exato' };
    }

    const versaoAnterior = await prisma.documentoKb.findFirst({
      where: { titulo },
      orderBy: { versao: 'desc' },
      select: { versao: true },
    });
    const versao = (versaoAnterior?.versao ?? 0) + 1;

    const doc = await prisma.documentoKb.create({
      data: {
        titulo,
        tipo: data.tipo || 'documento_livre',
        hashArquivo,
        versao,
        status: 'chunking',
        metadata: { source: 'texto_direto' },
      },
    });

    const chunks = chunkDocument(conteudo);
    await prisma.chunkKb.createMany({
      data: chunks.map((c, i) => ({
        documentoId: doc.id,
        documentoVersao: versao,
        chunkIndex: i,
        texto: c.texto,
        secao: c.secao,
        metadata: { chunk_total: chunks.length },
      })),
    });

    await prisma.documentoKb.update({ where: { id: doc.id }, data: { totalChunks: chunks.length } });

    if (versao > 1) {
      await deactivateOldDocumentVersions(titulo, doc.id);
    }

    await curarDocumentoKb(doc.id);
    await indexarDocumentoKb(doc.id);

    return { ok: true, data: { id: doc.id, chunks: chunks.length } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteDocumentoKb(id: string, callerEmail?: string): Promise<ActionResult> {
  const auth = await requireAdminEmail(callerEmail);
  if (!auth.ok) return auth;

  try {
    await prisma.documentoKb.delete({ where: { id } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function toggleDocumentoKb(id: string, callerEmail?: string): Promise<ActionResult<{ ativo: boolean }>> {
  const auth = await requireAdminEmail(callerEmail);
  if (!auth.ok) return auth;

  try {
    const doc = await prisma.documentoKb.findUnique({ where: { id } });
    if (!doc) return { ok: false, error: 'Documento não encontrado' };

    const updated = await prisma.documentoKb.update({ where: { id }, data: { ativo: !doc.ativo } });
    await prisma.chunkKb.updateMany({ where: { documentoId: id }, data: { ativo: updated.ativo } });

    return { ok: true, data: { ativo: updated.ativo } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateDocumentoKbTitulo(id: string, titulo: string, callerEmail?: string): Promise<ActionResult> {
  const auth = await requireAdminEmail(callerEmail);
  if (!auth.ok) return auth;

  try {
    const trimmed = titulo.trim();
    if (!trimmed) return { ok: false, error: 'Título é obrigatório' };
    await prisma.documentoKb.update({ where: { id }, data: { titulo: trimmed } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
