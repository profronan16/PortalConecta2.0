import { describe, it, expect } from 'vitest';
import {
  projetoVemDoSuap,
  camposBloqueadosParaEdicao,
  filtrarEdicaoProjeto,
  descreverCamposIgnorados,
  CAMPOS_CONTROLADOS_PELO_SUAP,
  CAMPOS_LIVRES_DO_PROFESSOR,
} from '@/lib/projetos-edicao';

/**
 * Testes do item 2.10 / SPEC §14 — "Professor ... edita campos controlados".
 *
 * Em projetos importados do SUAP, os campos institucionais são do SUAP; o
 * professor edita a apresentação do projeto. A checagem efetiva roda no
 * servidor (`updateMyProjeto`), usando exatamente estas funções.
 */

describe('projetoVemDoSuap', () => {
  it('reconhece pelo suapId', () => {
    expect(projetoVemDoSuap({ suapId: 123, source: 'MANUAL' })).toBe(true);
  });

  it('reconhece pelo source SUAP (mesmo sem suapId)', () => {
    expect(projetoVemDoSuap({ suapId: null, source: 'SUAP' })).toBe(true);
  });

  it('projeto manual não é do SUAP', () => {
    expect(projetoVemDoSuap({ suapId: null, source: 'MANUAL' })).toBe(false);
  });

  it('trata suapId 0 como ausente (0 é falsy, mas não pode escapar do bloqueio se vier de SUAP)', () => {
    expect(projetoVemDoSuap({ suapId: 0, source: 'SUAP' })).toBe(true);
    expect(projetoVemDoSuap({ suapId: 0, source: 'MANUAL' })).toBe(true);
  });
});

describe('camposBloqueadosParaEdicao', () => {
  it('bloqueia os institucionais quando o projeto vem do SUAP', () => {
    expect(camposBloqueadosParaEdicao({ suapId: 7 })).toEqual([
      'nome',
      'coordenador',
      'area',
      'status',
    ]);
  });

  it('não bloqueia nada em projeto manual', () => {
    expect(camposBloqueadosParaEdicao({ suapId: null, source: 'MANUAL' })).toEqual([]);
  });

  it('não deixa campos livres entrarem na lista de bloqueio', () => {
    const bloqueados = camposBloqueadosParaEdicao({ suapId: 1 }) as readonly string[];

    for (const campo of CAMPOS_LIVRES_DO_PROFESSOR) {
      expect(bloqueados).not.toContain(campo);
    }
    expect(bloqueados).toHaveLength(CAMPOS_CONTROLADOS_PELO_SUAP.length);
  });
});

describe('filtrarEdicaoProjeto', () => {
  const bloqueados = ['nome', 'coordenador', 'area', 'status'];

  it('mantém os campos livres e separa os bloqueados', () => {
    const { permitido, ignorados } = filtrarEdicaoProjeto(
      {
        nome: 'Nome novo',
        area: 'Pesquisa',
        descricao: 'Descrição editada',
        corPrimaria: '#000000',
        instagram: '@projeto',
      },
      bloqueados,
    );

    expect(permitido).toEqual({
      descricao: 'Descrição editada',
      corPrimaria: '#000000',
      instagram: '@projeto',
    });
    expect(ignorados).toEqual(['nome', 'area']);
  });

  it('ignora chaves ausentes (undefined) em vez de listá-las como bloqueadas', () => {
    const { permitido, ignorados } = filtrarEdicaoProjeto(
      { nome: undefined, descricao: 'ok' },
      bloqueados,
    );

    expect(permitido).toEqual({ descricao: 'ok' });
    expect(ignorados).toEqual([]);
  });

  it('aceita null como valor legítimo (limpar um campo livre)', () => {
    const { permitido, ignorados } = filtrarEdicaoProjeto({ email: null }, bloqueados);

    expect(permitido).toEqual({ email: null });
    expect(ignorados).toEqual([]);
  });

  it('sem bloqueios, repassa tudo', () => {
    const { permitido, ignorados } = filtrarEdicaoProjeto({ nome: 'X', area: 'Y' }, []);

    expect(permitido).toEqual({ nome: 'X', area: 'Y' });
    expect(ignorados).toEqual([]);
  });

  it('não muta o objeto de entrada', () => {
    const entrada = { nome: 'Original', descricao: 'D' };
    filtrarEdicaoProjeto(entrada, bloqueados);

    expect(entrada).toEqual({ nome: 'Original', descricao: 'D' });
  });
});

describe('descreverCamposIgnorados', () => {
  it('usa rótulos legíveis para a mensagem ao usuário', () => {
    expect(descreverCamposIgnorados(['nome', 'status'])).toBe('Nome, Situação');
  });

  it('degrada para o próprio nome do campo quando desconhecido', () => {
    expect(descreverCamposIgnorados(['campoNovo'])).toBe('campoNovo');
  });
});
