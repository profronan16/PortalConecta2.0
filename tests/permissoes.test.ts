import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

/**
 * Testes dos critérios §14 do SPEC (bloco "Geral / permissões"):
 *  - visitante não autenticado não lê dados de inscritos;
 *  - professor vê inscritos/apenas os SEUS projetos;
 *  - e-mail fora do domínio institucional NUNCA é promovido a professor.
 *
 * `src/lib/permissions.ts` é a fonte única dessas regras (usada por admin.ts,
 * professor.ts e pelos layouts de /admin e /professor), então é aqui que os
 * critérios ficam blindados.
 *
 * Atenção: o módulo lê ALLOWED_PROFESSOR_DOMAIN/ADMIN_EMAILS no momento do
 * import — por isso o env é fixado ANTES do import dinâmico.
 */

const prismaMock = vi.hoisted(() => ({
  projeto: {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, db: prismaMock }));

const MASTER = 'master@ifpr.edu.br';

vi.stubEnv('ADMIN_EMAILS', `${MASTER},segundo@ifpr.edu.br`);
vi.stubEnv('ALLOWED_PROFESSOR_DOMAIN', 'ifpr.edu.br');

let perms: typeof import('@/lib/permissions');

beforeAll(async () => {
  perms = await import('@/lib/permissions');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('domínio institucional (critério: não promover quem é de fora)', () => {
  it('aceita e-mail @ifpr.edu.br, sem diferenciar maiúsculas', () => {
    expect(perms.isDominioInstitucional('alguem@ifpr.edu.br')).toBe(true);
    expect(perms.isDominioInstitucional('ALGUEM@IFPR.EDU.BR')).toBe(true);
  });

  it('recusa domínios parecidos (sufixo enganoso não passa)', () => {
    expect(perms.isDominioInstitucional('alguem@gmail.com')).toBe(false);
    expect(perms.isDominioInstitucional('alguem@ifpr.edu.br.evil.com')).toBe(false);
    expect(perms.isDominioInstitucional('alguem@fake-ifpr.edu.br.net')).toBe(false);
  });
});

describe('Administrador Geral', () => {
  it('reconhece apenas o PRIMEIRO e-mail da lista ADMIN_EMAILS', () => {
    expect(perms.isAdministradorGeral(MASTER)).toBe(true);
    expect(perms.isAdministradorGeral('segundo@ifpr.edu.br')).toBe(false);
  });

  it('ignora maiúsculas/minúsculas', () => {
    expect(perms.isAdministradorGeral(MASTER.toUpperCase())).toBe(true);
  });

  it('passa em qualquer checagem de projeto SEM consultar o banco', async () => {
    const temAcesso = await perms.temAcessoAoProjeto('projeto-de-outro', MASTER);

    expect(temAcesso).toBe(true);
    expect(prismaMock.projeto.findUnique).not.toHaveBeenCalled();
  });
});

describe('acesso a projeto — professor só entra no que é dele', () => {
  const projetoDoProfessor = {
    coordenadorEmail: 'prof@ifpr.edu.br',
    viceCoordenadorEmail: null,
    admins: [],
    coordenadores: [],
  };

  it('reconhece coordenador, vice, admin explícito e coordenador cadastrado', () => {
    expect(perms.projetoTemAcesso(projetoDoProfessor, 'prof@ifpr.edu.br')).toBe(true);
    expect(
      perms.projetoTemAcesso({ ...projetoDoProfessor, viceCoordenadorEmail: 'vice@ifpr.edu.br' }, 'vice@ifpr.edu.br'),
    ).toBe(true);
    expect(
      perms.projetoTemAcesso({ ...projetoDoProfessor, admins: [{ email: 'apoio@ifpr.edu.br' }] }, 'apoio@ifpr.edu.br'),
    ).toBe(true);
    expect(
      perms.projetoTemAcesso(
        { ...projetoDoProfessor, coordenadores: [{ user: { email: 'coord@ifpr.edu.br' } }] },
        'coord@ifpr.edu.br',
      ),
    ).toBe(true);
  });

  it('nega quem não tem vínculo nenhum', () => {
    expect(perms.projetoTemAcesso(projetoDoProfessor, 'estranho@ifpr.edu.br')).toBe(false);
  });

  it('nega projeto de outro professor (busca no banco)', async () => {
    prismaMock.projeto.findUnique.mockResolvedValue(null);

    expect(await perms.temAcessoAoProjeto('projeto-alheio', 'prof@ifpr.edu.br')).toBe(false);
  });

  it('nega quando o e-mail não é coordenador do projeto encontrado', async () => {
    prismaMock.projeto.findUnique.mockResolvedValue({
      coordenadorEmail: 'outro@ifpr.edu.br',
      viceCoordenadorEmail: null,
      admins: [],
      coordenadores: [],
    });

    expect(await perms.temAcessoAoProjeto('id', 'prof@ifpr.edu.br')).toBe(false);
  });
});

describe('projetosAcessiveis — escopo da listagem', () => {
  it('Administrador Geral lista todos (sem filtro de vínculo)', async () => {
    prismaMock.projeto.findMany.mockResolvedValue([]);

    await perms.projetosAcessiveis(MASTER);

    const argumento = prismaMock.projeto.findMany.mock.calls[0][0];
    expect(argumento?.where).toBeUndefined();
  });

  it('professor lista somente os projetos em que tem vínculo', async () => {
    prismaMock.projeto.findMany.mockResolvedValue([]);

    await perms.projetosAcessiveis('prof@ifpr.edu.br');

    const argumento = prismaMock.projeto.findMany.mock.calls[0][0];
    expect(argumento.where).toEqual(perms.whereUsuarioTemAcessoAoProjeto('prof@ifpr.edu.br'));
    expect(JSON.stringify(argumento.where)).toContain('prof@ifpr.edu.br');
  });
});

describe('resolveUserRole — papel recalculado ao vivo', () => {
  it('Administrador Geral é sempre ADMIN (e é persistido)', async () => {
    prismaMock.user.upsert.mockResolvedValue({});

    expect(await perms.resolveUserRole(MASTER)).toBe('ADMIN');
    expect(prismaMock.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { role: 'ADMIN' } }),
    );
  });

  it('usuário que nunca logou devolve null', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    expect(await perms.resolveUserRole('novo@gmail.com')).toBeNull();
  });

  it('e-mail fora do domínio NÃO é promovido: papel legado é corrigido para ESTUDANTE', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'PROFESSOR' });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.projeto.count.mockResolvedValue(3);

    const role = await perms.resolveUserRole('impostor@gmail.com');

    expect(role).toBe('ESTUDANTE');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { email: 'impostor@gmail.com' },
      data: { role: 'ESTUDANTE' },
    });
    // Nem chega a consultar projetos: fora do domínio, a resposta é sempre ESTUDANTE.
    expect(prismaMock.projeto.count).not.toHaveBeenCalled();
  });

  it('e-mail institucional sem projeto vinculado é ESTUDANTE', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'PROFESSOR' });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.projeto.count.mockResolvedValue(0);

    expect(await perms.resolveUserRole('semprojeto@ifpr.edu.br')).toBe('ESTUDANTE');
  });

  it('e-mail institucional com projeto vinculado é PROFESSOR', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ESTUDANTE' });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.projeto.count.mockResolvedValue(1);

    expect(await perms.resolveUserRole('coord@ifpr.edu.br')).toBe('PROFESSOR');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { email: 'coord@ifpr.edu.br' },
      data: { role: 'PROFESSOR' },
    });
  });

  it('não escreve no banco quando o papel já está correto (evita update desnecessário)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ESTUDANTE' });
    prismaMock.projeto.count.mockResolvedValue(0);

    expect(await perms.resolveUserRole('estudante@ifpr.edu.br')).toBe('ESTUDANTE');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
