/**
 * POST /api/suap/sync/editais
 * Sincroniza editais do SUAP com o banco local.
 */
import { NextRequest, NextResponse } from 'next/server';
import { syncEditais } from '@/lib/suap-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get('secret') === secret) return true;
  return false;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  let dryRun = false;
  let forcar = false;
  try {
    const body = await req.json().catch(() => ({}));
    dryRun = body.dryRun === true;
    forcar = body.forcar === true;
  } catch {
    //
  }

  const startedAt = Date.now();

  try {
    const result = await syncEditais({ dryRun, forcar });
    return NextResponse.json({
      ok: true,
      dryRun,
      forcar,
      duracao: `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
