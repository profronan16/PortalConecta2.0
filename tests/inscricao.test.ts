import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Critérios §14 do bloco "Inscrições":
 *  - "Inscrição exige consentimento LGPD e ciência das regras";
 *  - a inscrição recusada NÃO pode persistir nada.
 *
 * Também cobre o rate limit do formulário público (achado S13 do
 * RELATORIO_TESTES.md), que é a primeira barreira da função.
 */

const prismaMock = vi.hoisted(() => ({
  rateLimitHit: {
    count: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  inscricao: {
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
  projeto: {
    findUnique: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, db: prismaMock }));

// `obterIpCliente` usa headers() do Next; fora de uma request real isso lança.
vi.mock('next/headers', () => ({
  headers: () => new Map<string, string>([['x-forwarded-for', '203.0.113.10']]),
}));

// Sem TURNSTILE_SECRET_KEY a verificação degrada para "true" (não bloqueia).
vi.stubEnv('TURNSTILE_SECRET_KEY', '');

import { criarInscricao } from '@/actions/inscricao';

type DadosInscricao = Parameters<typeof criarInscricao>[0];

function dadosBase(overrides: Partial<DadosInscricao> = {}): DadosInscricao {
  return {
    projetoId: 'projeto-1',
    nome_completo: 'Maria da Silva',
    email: 'maria@exemplo.com',
    telefone: '(43) 99999-0000',
    curso: 'Informática',
    ciencia_regras: true,
    consentimento_lgpd: true,
    tipo_interesse: 'BOLSISTA',
    ...overrides,
  } as DadosInscricao;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Por padrão, dentro do limite de rate limit.
  prismaMock.rateLimitHit.count.mockResolvedValue(0);
  prismaMock.rateLimitHit.create.mockResolvedValue({});
  // O rate limiter faz uma limpeza oportunista (`Math.random() < 0.02`) que
  // encadeia `.catch()` na promessa — sem um valor resolvido aqui, ~2% das
  // chamadas quebravam com "Cannot read properties of undefined (reading 'catch')"
  // e o teste falhava de forma intermitente.
  prismaMock.rateLimitHit.deleteMany.mockResolvedValue({ count: 0 });
});

describe('consentimento e ciência das regras (§14)', () => {
  it('recusa inscrição sem consentimento LGPD', async () => {
    const resultado = await criarInscricao(dadosBase({ consentimento_lgpd: false }));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toContain('LGPD');
    expect(prismaMock.inscricao.create).not.toHaveBeenCalled();
  });

  it('recusa inscrição sem ciência das regras', async () => {
    const resultado = await criarInscricao(dadosBase({ ciencia_regras: false }));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toMatch(/regras/i);
    expect(prismaMock.inscricao.create).not.toHaveBeenCalled();
  });

  it('a ciência das regras é exigida antes do consentimento LGPD', async () => {
    const resultado = await criarInscricao(
      dadosBase({ ciencia_regras: false, consentimento_lgpd: false }),
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toMatch(/regras/i);
  });
});

describe('validação de campos obrigatórios', () => {
  it('exige nome com pelo menos 2 caracteres', async () => {
    for (const nome of ['', '  ', 'A']) {
      const resultado = await criarInscricao(dadosBase({ nome_completo: nome }));
      expect(resultado.ok).toBe(false);
    }
    expect(prismaMock.inscricao.create).not.toHaveBeenCalled();
  });

  it('recusa e-mail malformado', async () => {
    for (const email of ['sem-arroba', 'a@b', 'a b@c.com', '']) {
      const resultado = await criarInscricao(dadosBase({ email }));
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(resultado.error).toMatch(/e-?mail/i);
    }
  });

  it('recusa idade fora da faixa 14–100', async () => {
    for (const idade of [13, 101]) {
      const resultado = await criarInscricao(dadosBase({ idade }));
      expect(resultado.ok).toBe(false);
    }
  });

  it('recusa telefone com quantidade de dígitos improvável', async () => {
    const resultado = await criarInscricao(dadosBase({ telefone: '123' }));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toMatch(/telefone/i);
  });

  it('aceita telefone vazio (campo opcional) sem barrar a inscrição nessa etapa', async () => {
    // Sem telefone, a validação passa daqui e a próxima barreira é o projeto —
    // provamos que NÃO foi recusado por telefone.
    prismaMock.projeto.findUnique.mockResolvedValue(null);

    const resultado = await criarInscricao(dadosBase({ telefone: '' }));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).not.toMatch(/telefone/i);
  });
});

describe('rate limit do formulário público', () => {
  it('bloqueia quando o IP estourou o limite da janela', async () => {
    prismaMock.rateLimitHit.count.mockResolvedValue(10);

    const resultado = await criarInscricao(dadosBase());

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toMatch(/muitas inscrições/i);
    expect(prismaMock.inscricao.create).not.toHaveBeenCalled();
  });

  it('registra o acesso quando está dentro do limite', async () => {
    prismaMock.projeto.findUnique.mockResolvedValue(null);

    await criarInscricao(dadosBase());

    expect(prismaMock.rateLimitHit.create).toHaveBeenCalled();
  });

  it('a checagem de limite acontece antes de qualquer validação de formulário', async () => {
    prismaMock.rateLimitHit.count.mockResolvedValue(99);

    const resultado = await criarInscricao(dadosBase({ nome_completo: '' }));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toMatch(/muitas inscrições/i);
  });
});
