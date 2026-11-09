import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `removerDaEquipe`: cancelar convite / tirar da equipe. Trava: acesso, que o id
 * da inscrição só vale dentro do próprio projeto, o destino da inscrição e que o
 * cargo de gestor da página sai junto.
 */

const prismaMock = vi.hoisted(() => ({
  inscricao: { findFirst: vi.fn(), delete: vi.fn(), update: vi.fn() },
  projeto: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  userPermission: { deleteMany: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, db: prismaMock }));

const permissoesMock = vi.hoisted(() => ({
  temAcessoAoProjeto: vi.fn(),
  isAdministradorGeral: vi.fn(),
  projetosAcessiveis: vi.fn(),
  whereUsuarioTemAcessoAoProjeto: vi.fn(),
  permissaoDeGestor: (id: string) => `gestor_pagina:${id}`,
  projetosComoGestor: vi.fn(),
}));
vi.mock('@/lib/permissions', () => permissoesMock);
vi.mock('@/lib/email', () => ({ enviarAtualizacaoStatus: vi.fn() }));
vi.mock('@/lib/projeto-sintetico', () => ({ sincronizarProjetoSintetico: vi.fn().mockResolvedValue(undefined) }));
const notificacoesMock = vi.hoisted(() => ({
  criarNotificacao: vi.fn(),
  notificarMudancaStatusInscricao: vi.fn(),
  rotuloStatusInscricao: (s: string) => s,
}));
vi.mock('@/lib/notificacoes', () => notificacoesMock);

import { removerDaEquipe } from '@/actions/professor';
import { sincronizarProjetoSintetico } from '@/lib/projeto-sintetico';

const CONVITE =
  'Convite da coordenação (Voluntário) em 09/11/2026 por coord@ifpr.edu.br: aguardando confirmação do estudante.';

function inscricao(over: Record<string, unknown> = {}) {
  return {
    id: 'i1', protocolo: 'PRJ-2026-000001', status: 'selecionado', user_id: 'u-aluna',
    nome_completo: 'Aluna Teste', resposta_aluno: null, observacao_interna: CONVITE,
    justificativa: null, ciencia_regras: false, consentimento_lgpd: false, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  permissoesMock.temAcessoAoProjeto.mockResolvedValue(true);
  prismaMock.projeto.findUnique.mockResolvedValue({ nome: 'Robótica' });
  prismaMock.user.findUnique.mockResolvedValue({ id: 'u-coord' });
  prismaMock.userPermission.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.auditLog.create.mockResolvedValue({});
  notificacoesMock.criarNotificacao.mockResolvedValue(true);
  // restoreMocks do vitest.config zera o que a fábrica do vi.mock definiu.
  vi.mocked(sincronizarProjetoSintetico).mockResolvedValue(undefined as never);
});

describe('removerDaEquipe', () => {
  it('sem acesso ao projeto: não mexe em nada', async () => {
    permissoesMock.temAcessoAoProjeto.mockResolvedValue(false);
    const r = await removerDaEquipe('p1', 'i1', 'x@ifpr.edu.br');
    expect(r.ok).toBe(false);
    expect(prismaMock.inscricao.delete).not.toHaveBeenCalled();
    expect(prismaMock.inscricao.update).not.toHaveBeenCalled();
  });

  it('busca a inscrição dentro do projeto (id de outro projeto não vale)', async () => {
    prismaMock.inscricao.findFirst.mockResolvedValue(null);
    const r = await removerDaEquipe('p1', 'i-de-outro-projeto', 'coord@ifpr.edu.br');
    expect(r.ok).toBe(false);
    expect(prismaMock.inscricao.findFirst.mock.calls[0][0].where).toEqual({
      id: 'i-de-outro-projeto',
      projeto_id: 'p1',
    });
  });

  it('inscrição que só existe pelo convite é apagada e o gestor sai junto', async () => {
    prismaMock.inscricao.findFirst.mockResolvedValue(inscricao());
    const r = await removerDaEquipe('p1', 'i1', 'coord@ifpr.edu.br');
    expect(r).toEqual({ ok: true, data: { nome: 'Aluna Teste', cancelouConvite: true } });
    expect(prismaMock.inscricao.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
    expect(prismaMock.userPermission.deleteMany).toHaveBeenCalledWith({
      where: { user_id: 'u-aluna', permission: 'gestor_pagina:p1' },
    });
  });

  it('quem já estava na equipe vindo de inscrição real vira "não selecionado", sem apagar', async () => {
    prismaMock.inscricao.findFirst.mockResolvedValue(
      inscricao({ resposta_aluno: 'aceito', observacao_interna: null, justificativa: 'quero', consentimento_lgpd: true, ciencia_regras: true }),
    );
    const r = await removerDaEquipe('p1', 'i1', 'coord@ifpr.edu.br');
    expect(r).toEqual({ ok: true, data: { nome: 'Aluna Teste', cancelouConvite: false } });
    expect(prismaMock.inscricao.delete).not.toHaveBeenCalled();
    const data = prismaMock.inscricao.update.mock.calls[0][0].data;
    expect(data.status).toBe('nao_selecionado');
    expect(data.resposta_aluno).toBeNull();
    expect(data.observacao_interna).toContain('Removido(a) da equipe');
  });

  it('inscrição que não está selecionada não é tratada como equipe', async () => {
    prismaMock.inscricao.findFirst.mockResolvedValue(inscricao({ status: 'recebida' }));
    const r = await removerDaEquipe('p1', 'i1', 'coord@ifpr.edu.br');
    expect(r.ok).toBe(false);
    expect(prismaMock.inscricao.delete).not.toHaveBeenCalled();
  });
});
