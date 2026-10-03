import { describe, it, expect } from 'vitest';
import {
  normalizarParamsProjetos,
  buildProjetoWhere,
  buildProjetosHref,
  paginasVisiveis,
  temFiltroAtivo,
  PROJETO_PUBLICO_WHERE,
  PROJETOS_PAGE_SIZE,
} from '@/lib/projetos-filtros';

/**
 * Testes do item 1.15b — paginação/filtro server-side de `/projetos`.
 *
 * O caso mais importante aqui é a regressão: a query pública antiga não tinha
 * `where` nenhum, então rascunhos (review_status != PUBLICADO) e projetos com
 * soft delete apareciam na listagem pública.
 */

describe('buildProjetoWhere — filtro base de visibilidade', () => {
  it('sempre restringe a projetos PUBLICADOS e não deletados', () => {
    const where = buildProjetoWhere({});

    expect(where.review_status).toBe('PUBLICADO');
    expect(where.deleted_at).toBeNull();
  });

  it('não deixa nenhum caminho sem o filtro base (mesmo com busca)', () => {
    const where = buildProjetoWhere({ q: 'horta', area: 'Extensão', status: 'ATIVO' });

    expect(where).toMatchObject({
      review_status: 'PUBLICADO',
      deleted_at: null,
      area: 'Extensão',
      status: 'ATIVO',
    });
  });

  it('busca textual é case-insensitive em nome, coordenador e área', () => {
    const where = buildProjetoWhere({ q: '  Maria  ' });

    expect(where.OR).toEqual([
      { nome: { contains: 'Maria', mode: 'insensitive' } },
      { coordenador: { contains: 'Maria', mode: 'insensitive' } },
      { area: { contains: 'Maria', mode: 'insensitive' } },
    ]);
  });

  it('ignora busca vazia/só espaços', () => {
    expect(buildProjetoWhere({ q: '   ' }).OR).toBeUndefined();
  });

  it('não muta a constante compartilhada do filtro público', () => {
    buildProjetoWhere({ area: 'Pesquisa', status: 'ATIVO' });
    expect(PROJETO_PUBLICO_WHERE).toEqual({ review_status: 'PUBLICADO', deleted_at: null });
  });
});

describe('normalizarParamsProjetos', () => {
  it('usa defaults seguros quando não há searchParams', () => {
    expect(normalizarParamsProjetos({})).toEqual({ q: '', area: '', status: '', page: 1 });
  });

  it('descarta página inválida, negativa ou NaN', () => {
    expect(normalizarParamsProjetos({ page: '0' }).page).toBe(1);
    expect(normalizarParamsProjetos({ page: '-3' }).page).toBe(1);
    expect(normalizarParamsProjetos({ page: 'abc' }).page).toBe(1);
    expect(normalizarParamsProjetos({ page: '9' }).page).toBe(9);
  });

  it('aceita searchParams repetidos (array) usando o primeiro valor', () => {
    expect(normalizarParamsProjetos({ q: ['primeiro', 'segundo'], area: ['X', 'Y'] })).toMatchObject({
      q: 'primeiro',
      area: 'X',
    });
  });

  it('limita o tamanho da busca (evita query gigante)', () => {
    expect(normalizarParamsProjetos({ q: 'a'.repeat(500) }).q).toHaveLength(100);
  });
});

describe('buildProjetosHref', () => {
  it('sem filtros e página 1 volta para a URL limpa', () => {
    expect(buildProjetosHref({}, 1)).toBe('/projetos');
  });

  it('preserva os filtros ao trocar de página', () => {
    const href = buildProjetosHref({ q: 'horta', area: 'Extensão', status: 'ATIVO' }, 3);

    expect(href).toContain('/projetos?');
    expect(href).toContain('q=horta');
    expect(href).toContain('area=Extens%C3%A3o');
    expect(href).toContain('status=ATIVO');
    expect(href).toContain('page=3');
  });

  it('omite page=1', () => {
    expect(buildProjetosHref({ area: 'Pesquisa' }, 1)).toBe('/projetos?area=Pesquisa');
  });
});

describe('paginasVisiveis', () => {
  it('mostra todas as páginas quando são poucas', () => {
    expect(paginasVisiveis(1, 3)).toEqual([1, 2, 3]);
  });

  it('insere elipse em listas longas mantendo primeira, atual e última', () => {
    const paginas = paginasVisiveis(10, 20);

    expect(paginas[0]).toBe(1);
    expect(paginas).toContain(10);
    expect(paginas[paginas.length - 1]).toBe(20);
    expect(paginas).toContain(-1);
  });

  it('não gera elipse espúria na primeira página', () => {
    expect(paginasVisiveis(1, 4)).toEqual([1, 2, 3, 4]);
  });
});

describe('temFiltroAtivo', () => {
  it('detecta cada tipo de filtro', () => {
    expect(temFiltroAtivo({})).toBe(false);
    expect(temFiltroAtivo({ q: '   ' })).toBe(false);
    expect(temFiltroAtivo({ q: 'x' })).toBe(true);
    expect(temFiltroAtivo({ area: 'Pesquisa' })).toBe(true);
    expect(temFiltroAtivo({ status: 'ATIVO' })).toBe(true);
  });
});

describe('tamanho de página', () => {
  it('é um inteiro positivo e divisível em grade de 4 colunas', () => {
    expect(Number.isInteger(PROJETOS_PAGE_SIZE)).toBe(true);
    expect(PROJETOS_PAGE_SIZE).toBeGreaterThan(0);
    expect(PROJETOS_PAGE_SIZE % 4).toBe(0);
  });
});
