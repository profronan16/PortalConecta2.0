import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { exigirAdmin } from '@/lib/admin-auth';

/**
 * Gestão de documentos do RAG (consulta, edição e exclusão).
 *
 * Autorização por ID token do Firebase no header `Authorization: Bearer <token>`
 * (ver src/lib/admin-auth.ts). Antes, o e-mail do admin vinha por query string ou
 * corpo JSON — bastava conhecer o e-mail administrativo para se passar por admin.
 */

export async function GET(request: NextRequest) {
  const auth = await exigirAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 });
  }

  const doc = await prisma.documentoKb.findUnique({
    where: { id },
    include: { chunks: { orderBy: { chunkIndex: 'asc' } } },
  });

  if (!doc) {
    return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data: doc });
}

export async function PUT(request: NextRequest) {
  const auth = await exigirAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { id?: string; titulo?: string; ativo?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 });
  }

  const { id, titulo, ativo } = body;
  if (!id) {
    return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 });
  }

  const doc = await prisma.documentoKb.findUnique({ where: { id } });
  if (!doc) {
    return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 });
  }

  const updated = await prisma.documentoKb.update({
    where: { id },
    data: {
      ...(titulo !== undefined && { titulo }),
      ...(ativo !== undefined && { ativo }),
    },
  });

  if (ativo !== undefined) {
    await prisma.chunkKb.updateMany({ where: { documentoId: id }, data: { ativo } });
  }

  return NextResponse.json({ ok: true, data: updated });
}

export async function DELETE(request: NextRequest) {
  const auth = await exigirAdmin(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 });
  }

  const doc = await prisma.documentoKb.findUnique({ where: { id } });
  if (!doc) {
    return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 });
  }

  // Chunks são deletados em cascade
  await prisma.documentoKb.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
