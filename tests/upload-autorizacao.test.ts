import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Regressão da falha de autorização de `/api/files/upload`.
 *
 * Antes: a rota lia `userEmail` do FormData e conferia o papel desse e-mail no
 * banco — ou seja, confiava na identidade afirmada pelo cliente. Quem soubesse o
 * e-mail de um professor/admin (público na documentação do projeto) gravava
 * arquivos de até 10 MB sem autenticação, servidos depois em `/files/`.
 *
 * Agora a identidade vem do ID token do Firebase, verificado no servidor.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
}));

const authMock = vi.hoisted(() => ({
  verifySessionToken: vi.fn(),
}));

const storageMock = vi.hoisted(() => ({
  salvarArquivo: vi.fn(),
  ArquivoInvalidoError: class ArquivoInvalidoError extends Error {
    status = 400;
  },
  LIMITE_PDF_BYTES: 10 * 1024 * 1024,
  LIMITE_IMAGEM_BYTES: 5 * 1024 * 1024,
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, db: prismaMock }));
vi.mock('@/lib/auth-helpers', () => authMock);
vi.mock('@/lib/file-storage', () => storageMock);

import { POST } from '@/app/api/files/upload/route';

function requisicao(campos: Record<string, string | File>): Request {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.append(chave, valor);
  return new Request('http://localhost/api/files/upload', { method: 'POST', body: fd });
}

const arquivoFalso = () => new File([Buffer.from('%PDF-1.4 teste')], 'edital.pdf', { type: 'application/pdf' });

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.salvarArquivo.mockResolvedValue({
    path: 'pdf/2026/edital.pdf',
    url: '/files/pdf/2026/edital.pdf',
    nomeOriginal: 'edital.pdf',
    tamanhoBytes: 13,
    mime: 'application/pdf',
  });
});

describe('sem identidade verificada', () => {
  it('recusa (401) quando não há idToken', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: false, error: 'Não autenticado' });

    const resposta = await POST(requisicao({ file: arquivoFalso() }) as never);

    expect(resposta.status).toBe(401);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(storageMock.salvarArquivo).not.toHaveBeenCalled();
  });

  it('recusa (401) quando o token é inválido/expirado', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: false, error: 'Sessão inválida ou expirada — faça login novamente' });

    const resposta = await POST(requisicao({ idToken: 'token-falso', file: arquivoFalso() }) as never);

    expect(resposta.status).toBe(401);
    expect(storageMock.salvarArquivo).not.toHaveBeenCalled();
  });

  it('IGNORA um userEmail forjado no formulário (a falha original)', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: false, error: 'Não autenticado' });

    const resposta = await POST(
      requisicao({ userEmail: 'ronan.lopes@ifpr.edu.br', file: arquivoFalso() }) as never,
    );

    expect(resposta.status).toBe(401);
    // O e-mail do corpo não é nem consultado no banco:
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(storageMock.salvarArquivo).not.toHaveBeenCalled();
  });
});

describe('token válido, papel insuficiente', () => {
  it('recusa (403) estudante', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: true, uid: 'u1', email: 'aluno@ifpr.edu.br' });
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ESTUDANTE' });

    const resposta = await POST(requisicao({ idToken: 'valido', file: arquivoFalso() }) as never);

    expect(resposta.status).toBe(403);
    expect(storageMock.salvarArquivo).not.toHaveBeenCalled();
  });

  it('recusa (403) e-mail que não existe no banco', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: true, uid: 'u2', email: 'fantasma@ifpr.edu.br' });
    prismaMock.user.findUnique.mockResolvedValue(null);

    const resposta = await POST(requisicao({ idToken: 'valido', file: arquivoFalso() }) as never);

    expect(resposta.status).toBe(403);
  });

  it('checa o papel do e-mail DO TOKEN (não do formulário)', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: true, uid: 'u3', email: 'prof@ifpr.edu.br' });
    prismaMock.user.findUnique.mockResolvedValue({ role: 'PROFESSOR' });

    await POST(requisicao({ idToken: 'valido', userEmail: 'admin@ifpr.edu.br' }) as never);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'prof@ifpr.edu.br' },
      select: { role: true },
    });
  });
});

describe('token válido com papel adequado', () => {
  it('passa da autorização e salva o arquivo (professor)', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: true, uid: 'u4', email: 'prof@ifpr.edu.br' });
    prismaMock.user.findUnique.mockResolvedValue({ role: 'PROFESSOR' });

    const resposta = await POST(requisicao({ idToken: 'valido', file: arquivoFalso() }) as never);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.ok).toBe(true);
    expect(corpo.data.url).toBe('/files/pdf/2026/edital.pdf');
    expect(storageMock.salvarArquivo).toHaveBeenCalledTimes(1);
  });

  it('aceita ADMIN também', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: true, uid: 'u5', email: 'admin@ifpr.edu.br' });
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ADMIN' });

    const resposta = await POST(requisicao({ idToken: 'valido', file: arquivoFalso() }) as never);

    expect(resposta.status).toBe(200);
  });

  it('recusa (400) quando não vem arquivo, mesmo autorizado', async () => {
    authMock.verifySessionToken.mockResolvedValue({ ok: true, uid: 'u6', email: 'prof@ifpr.edu.br' });
    prismaMock.user.findUnique.mockResolvedValue({ role: 'PROFESSOR' });

    const resposta = await POST(requisicao({ idToken: 'valido' }) as never);

    expect(resposta.status).toBe(400);
    expect(storageMock.salvarArquivo).not.toHaveBeenCalled();
  });
});
