import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { exigirAdministradorGeral } from '@/lib/admin-auth';

/**
 * Token de acesso à API do SUAP.
 *
 * Só o Administrador Geral pode ler/gravar/remover. A autorização é feita pelo
 * ID token do Firebase no header `Authorization: Bearer <token>`
 * (ver src/lib/admin-auth.ts) — antes o e-mail vinha por query string ou corpo
 * JSON, e como o e-mail mestre está na documentação pública do projeto, dava para
 * qualquer pessoa sobrescrever o token usado por toda a sincronização.
 */

const TOKEN_FILE = join(process.cwd(), '.suap-token.json');

export async function GET(request: NextRequest) {
  const auth = await exigirAdministradorGeral(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const data = await readFile(TOKEN_FILE, 'utf-8');
    const { token, updatedAt } = JSON.parse(data);
    return NextResponse.json({ ok: true, token, updatedAt });
  } catch {
    return NextResponse.json({ ok: false, token: null });
  }
}

export async function POST(request: NextRequest) {
  const auth = await exigirAdministradorGeral(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { token } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token inválido' }, { status: 400 });
    }

    if (!token.startsWith('eyJ')) {
      return NextResponse.json({ error: 'Token deve começar com "eyJ"' }, { status: 400 });
    }

    await writeFile(TOKEN_FILE, JSON.stringify({
      token,
      updatedAt: new Date().toISOString(),
    }, null, 2));

    return NextResponse.json({ ok: true, message: 'Token salvo com sucesso' });
  } catch (e) {
    console.error('Erro ao salvar token:', e);
    return NextResponse.json({ error: 'Erro ao salvar token' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await exigirAdministradorGeral(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { unlink } = await import('fs/promises');
    await unlink(TOKEN_FILE);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
