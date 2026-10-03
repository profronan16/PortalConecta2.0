import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Regressão das rotas administrativas que confiavam em `adminEmail` vindo do
 * cliente (query string ou corpo JSON).
 *
 * Como os e-mails administrativos estão na documentação pública do projeto,
 * bastava conhecer o e-mail para se passar por admin — inclusive para
 * sobrescrever o token do SUAP. Agora a identidade vem do ID token do Firebase
 * no header `Authorization: Bearer <token>`, verificado no servidor.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  documentoKb: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  chunkKb: { updateMany: vi.fn() },
}));

const authMock = vi.hoisted(() => ({ verifySessionToken: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, db: prismaMock }));
vi.mock('@/lib/auth-helpers', () => authMock);

const MASTER = 'master@ifpr.edu.br';
vi.stubEnv('ADMIN_EMAILS', MASTER);
vi.stubEnv('ALLOWED_PROFESSOR_DOMAIN', 'ifpr.edu.br');

let adminAuth: typeof import('@/lib/admin-auth');
let rotaSuap: typeof import('@/app/api/admin/suap/token/route');
let rotaRag: typeof import('@/app/api/admin/rag/docs/route');

beforeAll(async () => {
  adminAuth = await import('@/lib/admin-auth');
  rotaSuap = await import('@/app/api/admin/suap/token/route');
  rotaRag = await import('@/app/api/admin/rag/docs/route');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function requisicao(url: string, init: { metodo?: string; token?: string; corpo?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers.Authorization = `Bearer ${init.token}`;
  if (init.corpo !== undefined) headers['Content-Type'] = 'application/json';

  return new NextRequest(url, {
    method: init.metodo ?? 'GET',
    headers,
    ...(init.corpo !== undefined ? { body: JSON.stringify(init.corpo) } : {}),
  });
}

describe('tokenDeAutorizacao', () => {
  it('extrai o token do header Bearer (sem diferenciar maiúsculas)', () => {
    expect(adminAuth.tokenDeAutorizacao(requisicao('http://x/api', { token: 'abc.def' }))).toBe('abc.def');
  });

  it('devolve undefined quando o header falta ou não é Bearer', () => {
    expect(adminAuth.tokenDeAutorizacao(requisicao('http://x/api'))).toBeUndefined();
    const semBearer = new NextRequest('http://x/api', { headers: { Authorization: 'Basic 123' } });
    expect(adminAuth.tokenDeAutorizacao(semBearer)).toBeUndefined();
  });

  it('devolve undefined para "Bearer " vazio', () => {
    const vazio = new NextRequest('http://x/api', { headers: { Authorization: 'Bearer   ' } });
    expect(adminAuth.tokenDeAutorizacao(vazio)).toBeUndefined();
  });
});

describe('exigirAdmin', () => {
  it('recusa (401) sem token', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: false, error: 'Não autenticado' });

    const resultado = await adminAuth.exigirAdmin(requisicao('http://x/api'));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(401);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('recusa (401) com token inválido', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: false, error: 'Sessão inválida ou expirada — faça login novamente' });

    const resultado = await adminAuth.exigirAdmin(requisicao('http://x/api', { token: 'forjado' }));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(401);
  });

  it('recusa (403) quem não é ADMIN no banco', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: true, uid: 'u1', email: 'prof@ifpr.edu.br' });
    prismaMock.user.findUnique.mockResolvedValue({ role: 'PROFESSOR' });

    const resultado = await adminAuth.exigirAdmin(requisicao('http://x/api', { token: 'valido' }));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(403);
  });

  it('aceita ADMIN, com o e-mail vindo do token', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: true, uid: 'u2', email: 'admin@ifpr.edu.br' });
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ADMIN' });

    const resultado = await adminAuth.exigirAdmin(requisicao('http://x/api', { token: 'valido' }));

    expect(resultado).toEqual({ ok: true, email: 'admin@ifpr.edu.br' });
  });
});

describe('exigirAdministradorGeral', () => {
  it('recusa (403) um ADMIN que não é o Administrador Geral', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: true, uid: 'u3', email: 'admin2@ifpr.edu.br' });

    const resultado = await adminAuth.exigirAdministradorGeral(requisicao('http://x/api', { token: 'valido' }));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.status).toBe(403);
  });

  it('aceita o e-mail mestre', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: true, uid: 'u4', email: MASTER });

    const resultado = await adminAuth.exigirAdministradorGeral(requisicao('http://x/api', { token: 'valido' }));

    expect(resultado).toEqual({ ok: true, email: MASTER });
  });
});

describe('rota do token do SUAP', () => {
  it('ignora adminEmail forjado no corpo e recusa (401)', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: false, error: 'Não autenticado' });

    const resposta = await rotaSuap.POST(
      requisicao('http://x/api/admin/suap/token', { metodo: 'POST', corpo: { token: 'eyJabc', adminEmail: MASTER } }),
    );

    expect(resposta.status).toBe(401);
  });

  it('com o mestre autenticado, valida o token do SUAP (400 para valor inválido)', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: true, uid: 'u5', email: MASTER });

    const resposta = await rotaSuap.POST(
      requisicao('http://x/api/admin/suap/token', { metodo: 'POST', token: 'valido', corpo: { token: 'nao-comeca-com-eyJ' } }),
    );

    expect(resposta.status).toBe(400);
  });

  it('recusa (401) DELETE sem token', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: false, error: 'Não autenticado' });

    const resposta = await rotaSuap.DELETE(requisicao('http://x/api/admin/suap/token', { metodo: 'DELETE' }));

    expect(resposta.status).toBe(401);
  });
});

describe('rota de documentos do RAG', () => {
  it('ignora adminEmail forjado na query e recusa (401)', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: false, error: 'Não autenticado' });

    const resposta = await rotaRag.GET(
      requisicao(`http://x/api/admin/rag/docs?id=doc1&adminEmail=${encodeURIComponent(MASTER)}`),
    );

    expect(resposta.status).toBe(401);
    expect(prismaMock.documentoKb.findUnique).not.toHaveBeenCalled();
  });

  it('com ADMIN autenticado, segue para a consulta (404 quando não existe)', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: true, uid: 'u6', email: 'admin@ifpr.edu.br' });
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prismaMock.documentoKb.findUnique.mockResolvedValue(null);

    const resposta = await rotaRag.GET(requisicao('http://x/api/admin/rag/docs?id=doc1', { token: 'valido' }));

    expect(resposta.status).toBe(404);
  });
});
