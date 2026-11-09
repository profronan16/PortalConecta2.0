import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  feedback: { create: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));
const sessaoMock = vi.hoisted(() => ({ getVerifiedServerSession: vi.fn() }));
const limiteMock = vi.hoisted(() => ({ rateLimitado: vi.fn(), obterIpCliente: vi.fn(() => '203.0.113.9') }));
const captchaMock = vi.hoisted(() => ({ verificarTurnstile: vi.fn() }));
const notifMock = vi.hoisted(() => ({ criarNotificacao: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, db: prismaMock }));
vi.mock('@/lib/session', () => sessaoMock);
vi.mock('@/lib/rate-limit', () => limiteMock);
vi.mock('@/lib/turnstile', () => captchaMock);
vi.mock('@/lib/notificacoes', () => notifMock);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  atualizarStatusFeedback,
  contarFeedbacksNovos,
  enviarFeedback,
  excluirFeedback,
  listarFeedbacks,
} from '@/actions/feedback';

const entrada = { tipo: 'problema', mensagem: 'O botão de inscrição não abre no celular.', contato: '', pagina: '/projetos/horta' };

function comoAdmin() {
  sessaoMock.getVerifiedServerSession.mockResolvedValue({ uid: 'u1', email: 'admin@ifpr.edu.br' });
  prismaMock.user.findUnique.mockResolvedValue({ role: 'ADMIN', id: 'a1' });
}
function comoEstudante() {
  sessaoMock.getVerifiedServerSession.mockResolvedValue({ uid: 'u2', email: 'aluno@aluno.ifpr.edu.br' });
  prismaMock.user.findUnique.mockResolvedValue({ role: 'ESTUDANTE', id: 'e1' });
}

beforeEach(() => {
  vi.clearAllMocks();
  limiteMock.rateLimitado.mockResolvedValue({ ok: true });
  captchaMock.verificarTurnstile.mockResolvedValue(true);
  sessaoMock.getVerifiedServerSession.mockResolvedValue(null);
  prismaMock.feedback.create.mockResolvedValue({ id: 'f1' });
  prismaMock.user.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
});

describe('enviarFeedback (público)', () => {
  it('grava como anônimo e avisa cada administrador', async () => {
    const r = await enviarFeedback(entrada);
    expect(r).toEqual({ ok: true });
    expect(prismaMock.feedback.create).toHaveBeenCalledWith({
      data: { tipo: 'problema', mensagem: entrada.mensagem, contato: null, pagina: '/projetos/horta', user_id: null },
    });
    expect(notifMock.criarNotificacao).toHaveBeenCalledTimes(2);
    expect(notifMock.criarNotificacao).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'a1', link: '/admin/feedbacks', titulo: 'Novo feedback: Problema no site' }),
    );
  });

  it('vincula à conta quando há sessão', async () => {
    comoEstudante();
    await enviarFeedback(entrada);
    expect(prismaMock.feedback.create).toHaveBeenCalledWith({ data: expect.objectContaining({ user_id: 'e1' }) });
  });

  it('robô (campo-isca) recebe sucesso, mas nada é gravado nem avisado', async () => {
    const r = await enviarFeedback({ ...entrada, website: 'http://spam.example' });
    expect(r).toEqual({ ok: true });
    expect(prismaMock.feedback.create).not.toHaveBeenCalled();
    expect(notifMock.criarNotificacao).not.toHaveBeenCalled();
  });

  it('valida antes de gastar limite ou tocar no banco', async () => {
    const r = await enviarFeedback({ ...entrada, mensagem: 'oi' });
    expect(r).toMatchObject({ ok: false });
    expect(limiteMock.rateLimitado).not.toHaveBeenCalled();
    expect(prismaMock.feedback.create).not.toHaveBeenCalled();
  });

  it('respeita o limite por IP', async () => {
    limiteMock.rateLimitado.mockResolvedValue({ ok: false, retryAfterSeconds: 3600 });
    const r = await enviarFeedback(entrada);
    expect(r).toMatchObject({ ok: false });
    expect(limiteMock.rateLimitado).toHaveBeenCalledWith('feedback', '203.0.113.9', 5, 3_600_000);
    expect(prismaMock.feedback.create).not.toHaveBeenCalled();
  });

  it('recusa quando o CAPTCHA falha', async () => {
    captchaMock.verificarTurnstile.mockResolvedValue(false);
    const r = await enviarFeedback(entrada, 'token-ruim');
    expect(r).toMatchObject({ ok: false });
    expect(prismaMock.feedback.create).not.toHaveBeenCalled();
  });

  it('falha de aviso não derruba o envio', async () => {
    prismaMock.user.findMany.mockRejectedValue(new Error('banco fora'));
    expect(await enviarFeedback(entrada)).toEqual({ ok: true });
  });

  it('erro de gravação devolve mensagem amigável, sem detalhe técnico', async () => {
    prismaMock.feedback.create.mockRejectedValue(new Error('relation "Feedback" does not exist'));
    const r = await enviarFeedback(entrada);
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain('relation');
  });
});

describe('ações do administrador', () => {
  it('negam sem sessão', async () => {
    sessaoMock.getVerifiedServerSession.mockResolvedValue(null);
    expect(await listarFeedbacks()).toMatchObject({ ok: false });
    expect(await atualizarStatusFeedback('f1', 'lido')).toMatchObject({ ok: false });
    expect(await excluirFeedback('f1')).toMatchObject({ ok: false });
    expect(await contarFeedbacksNovos()).toBe(0);
  });

  it('negam quem não é ADMIN (inclusive professor e estudante)', async () => {
    comoEstudante();
    expect(await listarFeedbacks()).toMatchObject({ ok: false });
    expect(await atualizarStatusFeedback('f1', 'lido')).toMatchObject({ ok: false });
    expect(await excluirFeedback('f1')).toMatchObject({ ok: false });
    expect(await contarFeedbacksNovos()).toBe(0);
    expect(prismaMock.feedback.findMany).not.toHaveBeenCalled();
    expect(prismaMock.feedback.update).not.toHaveBeenCalled();
    expect(prismaMock.feedback.delete).not.toHaveBeenCalled();
  });

  it('lista com contagem por situação e filtro', async () => {
    comoAdmin();
    prismaMock.feedback.findMany.mockResolvedValue([
      {
        id: 'f1', tipo: 'elogio', mensagem: 'Gostei muito do portal!', contato: null, pagina: null, status: 'novo',
        created_at: new Date('2026-11-09T12:00:00Z'), user: { name: 'Ana', email: 'ana@aluno.ifpr.edu.br' },
      },
    ]);
    prismaMock.feedback.count.mockResolvedValue(1);
    prismaMock.feedback.groupBy.mockResolvedValue([
      { status: 'novo', _count: { _all: 3 } },
      { status: 'resolvido', _count: { _all: 2 } },
    ]);

    const r = await listarFeedbacks({ status: 'novo', pagina: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.contagem).toEqual({ novo: 3, lido: 0, resolvido: 2 });
      expect(r.data.itens[0]).toMatchObject({ id: 'f1', autor: { nome: 'Ana', email: 'ana@aluno.ifpr.edu.br' } });
    }
    expect(prismaMock.feedback.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'novo' }, take: 20, skip: 0 }));
  });

  it('ignora filtro de status inválido', async () => {
    comoAdmin();
    prismaMock.feedback.findMany.mockResolvedValue([]);
    prismaMock.feedback.count.mockResolvedValue(0);
    prismaMock.feedback.groupBy.mockResolvedValue([]);
    await listarFeedbacks({ status: "novo' OR 1=1", pagina: -5 });
    expect(prismaMock.feedback.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, skip: 0 }));
  });

  it('atualiza status e recusa status inválido', async () => {
    comoAdmin();
    prismaMock.feedback.update.mockResolvedValue({});
    expect(await atualizarStatusFeedback('f1', 'resolvido')).toEqual({ ok: true });
    expect(prismaMock.feedback.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { status: 'resolvido' } });
    expect(await atualizarStatusFeedback('f1', 'apagado')).toMatchObject({ ok: false });
    expect(prismaMock.feedback.update).toHaveBeenCalledTimes(1);
  });

  it('exclui e conta as novas', async () => {
    comoAdmin();
    prismaMock.feedback.delete.mockResolvedValue({});
    prismaMock.feedback.count.mockResolvedValue(4);
    expect(await excluirFeedback('f1')).toEqual({ ok: true });
    expect(await contarFeedbacksNovos()).toBe(4);
  });
});
