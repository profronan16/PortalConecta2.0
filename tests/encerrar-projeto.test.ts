import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * "Encerrar projeto" na tela de gerenciar (`alterarEncerramentoDoProjeto`).
 *
 * Travam-se: quem não coordena não encerra; encerrar fecha as inscrições e não
 * apaga nada; não dá para encerrar duas vezes nem reabrir quem não está
 * encerrado; reabrir volta para ATIVO sem reabrir as inscrições.
 */

const prismaMock = vi.hoisted(() => ({
  projeto: { findFirst: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, db: prismaMock }));

const permissoesMock = vi.hoisted(() => ({
  temAcessoAoProjeto: vi.fn(),
  isAdministradorGeral: vi.fn(),
  projetosAcessiveis: vi.fn(),
  whereUsuarioTemAcessoAoProjeto: vi.fn(),
}));
vi.mock('@/lib/permissions', () => permissoesMock);
vi.mock('@/lib/email', () => ({ enviarAtualizacaoStatus: vi.fn() }));
vi.mock('@/lib/projeto-sintetico', () => ({ sincronizarProjetoSintetico: vi.fn().mockResolvedValue(undefined) }));

import { alterarEncerramentoDoProjeto } from '@/actions/professor';
import { sincronizarProjetoSintetico } from '@/lib/projeto-sintetico';

const EMAIL = 'coord@ifpr.edu.br';

beforeEach(() => {
  vi.clearAllMocks();
  permissoesMock.temAcessoAoProjeto.mockResolvedValue(true);
  prismaMock.projeto.update.mockResolvedValue({});
  prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' });
  prismaMock.auditLog.create.mockResolvedValue({});
  vi.mocked(sincronizarProjetoSintetico).mockResolvedValue(undefined as never);
});

describe('alterarEncerramentoDoProjeto', () => {
  it('sem acesso ao projeto: não altera nada', async () => {
    permissoesMock.temAcessoAoProjeto.mockResolvedValue(false);
    const r = await alterarEncerramentoDoProjeto('p1', true, EMAIL);
    expect(r.ok).toBe(false);
    expect(prismaMock.projeto.update).not.toHaveBeenCalled();
  });

  it('encerrar: status ENCERRADO e inscrições fechadas', async () => {
    prismaMock.projeto.findFirst.mockResolvedValue({ status: 'INSCRICOES_ABERTAS' });
    const r = await alterarEncerramentoDoProjeto('p1', true, EMAIL);
    expect(r).toEqual({ ok: true, data: { status: 'ENCERRADO' } });
    expect(prismaMock.projeto.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { status: 'ENCERRADO', inscricoes_abertas: false },
    });
    expect(sincronizarProjetoSintetico).toHaveBeenCalledWith('p1');
  });

  it('encerrar de novo é recusado com mensagem clara', async () => {
    prismaMock.projeto.findFirst.mockResolvedValue({ status: 'ENCERRADO' });
    const r = await alterarEncerramentoDoProjeto('p1', true, EMAIL);
    expect(r).toEqual({ ok: false, error: 'Este projeto já está encerrado.' });
    expect(prismaMock.projeto.update).not.toHaveBeenCalled();
  });

  it('reabrir: volta para ATIVO sem mexer nas inscrições', async () => {
    prismaMock.projeto.findFirst.mockResolvedValue({ status: 'ENCERRADO' });
    const r = await alterarEncerramentoDoProjeto('p1', false, EMAIL);
    expect(r).toEqual({ ok: true, data: { status: 'ATIVO' } });
    expect(prismaMock.projeto.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { status: 'ATIVO' },
    });
  });

  it('só reabre projeto que está encerrado', async () => {
    prismaMock.projeto.findFirst.mockResolvedValue({ status: 'ATIVO' });
    const r = await alterarEncerramentoDoProjeto('p1', false, EMAIL);
    expect(r.ok).toBe(false);
    expect(prismaMock.projeto.update).not.toHaveBeenCalled();
  });

  it('projeto removido ou inexistente: erro amigável', async () => {
    prismaMock.projeto.findFirst.mockResolvedValue(null);
    const r = await alterarEncerramentoDoProjeto('p1', true, EMAIL);
    expect(r.ok).toBe(false);
    expect(prismaMock.projeto.update).not.toHaveBeenCalled();
  });
});
