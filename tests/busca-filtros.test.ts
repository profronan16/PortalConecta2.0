import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  BUSCA_HREF,
  BUSCA_LIMITE_POR_TIPO,
  BUSCA_MAX_TERMO,
  BUSCA_MIN_TERMO,
  TIPOS_BUSCA,
  TIPO_BUSCA_INFO,
  ancoraDoTipo,
  buildBuscaHref,
  contemTermo,
  limitarResultados,
  normalizarLimite,
  normalizarParamsBusca,
  normalizarTermoBusca,
  ordenarPorRelevancia,
  relevanciaDoItem,
  semAcento,
  termoBuscaValido,
} from '@/lib/busca-filtros';

/**
 * Testes do item 6.6 — busca global (projetos + editais + posts).
 *
 * O que mais importa aqui é a regra de "termo vazio/só espaços não busca"
 * (sem ela, `?q=` vazio viraria um `contains` que casa com o banco inteiro) e
 * a montagem de href, que é o contrato reaproveitado pela UI/Header.
 */

describe('normalizarTermoBusca', () => {
  it('remove espaços das pontas', () => {
    expect(normalizarTermoBusca('   horta urbana  ')).toBe('horta urbana');
  });

  it('colapsa espaços internos repetidos (o contains do banco é literal)', () => {
    expect(normalizarTermoBusca('horta    urbana')).toBe('horta urbana');
    expect(normalizarTermoBusca('bolsa\n\t2025')).toBe('bolsa 2025');
  });

  it('termo vazio, só espaços ou ausente vira string vazia', () => {
    expect(normalizarTermoBusca('')).toBe('');
    expect(normalizarTermoBusca('     ')).toBe('');
    expect(normalizarTermoBusca(undefined)).toBe('');
  });

  it('aceita searchParams repetidos (array) usando o primeiro valor', () => {
    expect(normalizarTermoBusca(['primeiro', 'segundo'])).toBe('primeiro');
  });

  it('limita o tamanho (termo gigante não vira query gigante)', () => {
    expect(normalizarTermoBusca('a'.repeat(500))).toHaveLength(BUSCA_MAX_TERMO);
  });

  it('preserva acentos — o banco guarda o texto acentuado', () => {
    expect(normalizarTermoBusca(' Extensão ')).toBe('Extensão');
    expect(normalizarTermoBusca('Ivaiporã')).toBe('Ivaiporã');
  });

  it('o corte do limite não deixa espaço sobrando no fim', () => {
    const termo = normalizarTermoBusca(`${'a'.repeat(BUSCA_MAX_TERMO - 1)} b`);
    expect(termo).toBe('a'.repeat(BUSCA_MAX_TERMO - 1));
  });
});

describe('termoBuscaValido', () => {
  it('recusa termo vazio ou só espaços', () => {
    expect(termoBuscaValido('')).toBe(false);
    expect(termoBuscaValido('   ')).toBe(false);
  });

  it('recusa termo curto demais (1 caractere casaria com quase tudo)', () => {
    expect(termoBuscaValido('a')).toBe(false);
    expect(termoBuscaValido('ab')).toBe(true);
    expect(BUSCA_MIN_TERMO).toBeGreaterThanOrEqual(2);
  });

  it('aceita do mínimo até o máximo e recusa acima do máximo', () => {
    expect(termoBuscaValido('a'.repeat(BUSCA_MAX_TERMO))).toBe(true);
    expect(termoBuscaValido('a'.repeat(BUSCA_MAX_TERMO + 1))).toBe(false);
    expect(BUSCA_MAX_TERMO).toBeGreaterThan(BUSCA_MIN_TERMO);
  });
});

describe('normalizarParamsBusca', () => {
  it('usa defaults seguros quando não há searchParams', () => {
    expect(normalizarParamsBusca({})).toEqual({ q: '', valido: false });
  });

  it('normaliza e marca o termo como válido', () => {
    expect(normalizarParamsBusca({ q: '  bolsa   de extensão ' })).toEqual({
      q: 'bolsa de extensão',
      valido: true,
    });
  });

  it('marca como inválido o termo que não passa das regras mínimas', () => {
    expect(normalizarParamsBusca({ q: 'a' }).valido).toBe(false);
    expect(normalizarParamsBusca({ q: '  ' }).valido).toBe(false);
  });

  it('usa o primeiro valor quando o parâmetro vem repetido', () => {
    expect(normalizarParamsBusca({ q: ['horta', 'bolsa'] }).q).toBe('horta');
  });
});

describe('buildBuscaHref', () => {
  it('sem termo volta para a URL limpa', () => {
    expect(buildBuscaHref({})).toBe(BUSCA_HREF);
    expect(buildBuscaHref({ q: '   ' })).toBe(BUSCA_HREF);
  });

  it('monta `/busca?q=...` com o termo normalizado', () => {
    expect(buildBuscaHref({ q: '  horta  urbana ' })).toBe('/busca?q=horta+urbana');
  });

  it('codifica o termo (acento, & e espaço não quebram a querystring)', () => {
    const href = buildBuscaHref({ q: 'extensão & pesquisa' });

    expect(href.startsWith('/busca?')).toBe(true);
    expect(href).toContain('q=extens%C3%A3o');
    expect(href).not.toContain(' ');
    // `&` do termo precisa ir codificado, senão viraria um parâmetro novo
    expect(href).not.toContain('&');
  });
});

describe('semAcento e contemTermo', () => {
  it('remove acentos e caixa', () => {
    expect(semAcento('Extensão')).toBe('extensao');
    expect(semAcento('Ivaiporã')).toBe('ivaipora');
  });

  it('casa ignorando caixa e acentos nos dois lados', () => {
    expect(contemTermo('Projeto de Extensão Rural', 'extensao')).toBe(true);
    expect(contemTermo('Projeto de Extensao Rural', 'extensão')).toBe(true);
    expect(contemTermo('Horta Comunitária', 'HORTA')).toBe(true);
  });

  it('não casa quando o termo não existe no texto', () => {
    expect(contemTermo('Horta Comunitária', 'bolsa')).toBe(false);
  });

  it('texto nulo/vazio ou termo vazio devolvem false', () => {
    expect(contemTermo(null, 'horta')).toBe(false);
    expect(contemTermo(undefined, 'horta')).toBe(false);
    expect(contemTermo('', 'horta')).toBe(false);
    expect(contemTermo('horta', '')).toBe(false);
    expect(contemTermo('horta', '   ')).toBe(false);
  });
});

describe('ordenarPorRelevancia', () => {
  const itens = [
    { titulo: 'Projeto de Robótica', subtitulo: 'Extensão' },
    { titulo: 'Horta Comunitária', subtitulo: 'Coordenador: Maria' },
    { titulo: 'Clube de Ciências', subtitulo: 'Horta escolar e meio ambiente' },
  ];

  it('dá peso 2 ao título, 1 ao subtítulo e 0 ao resto', () => {
    expect(relevanciaDoItem(itens[1], 'horta')).toBe(2);
    expect(relevanciaDoItem(itens[2], 'horta')).toBe(1);
    expect(relevanciaDoItem(itens[0], 'horta')).toBe(0);
  });

  it('coloca quem casou no título antes de quem casou no subtítulo', () => {
    const ordenados = ordenarPorRelevancia(itens, 'horta');

    expect(ordenados.map((i) => i.titulo)).toEqual([
      'Horta Comunitária',
      'Clube de Ciências',
      'Projeto de Robótica',
    ]);
  });

  it('mantém a ordem original (do banco) em caso de empate', () => {
    const ordenados = ordenarPorRelevancia(itens, 'zzz');
    expect(ordenados).toEqual(itens);
  });

  it('não muta o array recebido', () => {
    const original = [...itens];
    ordenarPorRelevancia(itens, 'horta');
    expect(itens).toEqual(original);
  });
});

describe('limitarResultados / normalizarLimite', () => {
  const itens = Array.from({ length: 12 }, (_, i) => `item-${i}`);

  it('usa o limite padrão por categoria quando nenhum é informado', () => {
    expect(limitarResultados(itens)).toHaveLength(BUSCA_LIMITE_POR_TIPO);
    expect(BUSCA_LIMITE_POR_TIPO).toBeGreaterThan(0);
  });

  it('respeita um limite explícito', () => {
    expect(limitarResultados(itens, 3)).toEqual(['item-0', 'item-1', 'item-2']);
  });

  it('cai no padrão quando o limite é inválido', () => {
    expect(normalizarLimite(0)).toBe(BUSCA_LIMITE_POR_TIPO);
    expect(normalizarLimite(-5)).toBe(BUSCA_LIMITE_POR_TIPO);
    expect(normalizarLimite(Number.NaN)).toBe(BUSCA_LIMITE_POR_TIPO);
    expect(normalizarLimite(Number.POSITIVE_INFINITY)).toBe(BUSCA_LIMITE_POR_TIPO);
  });

  it('nunca devolve mais itens do que existem', () => {
    expect(limitarResultados(itens, 999)).toHaveLength(itens.length);
    expect(limitarResultados([], 5)).toEqual([]);
  });
});

describe('tipos pesquisáveis', () => {
  it('cobre exatamente projetos, editais e posts', () => {
    expect([...TIPOS_BUSCA]).toEqual(['projeto', 'edital', 'post']);
  });

  it('tem rótulo e âncora para cada tipo, sem âncora repetida', () => {
    const ancoras = TIPOS_BUSCA.map((tipo) => ancoraDoTipo(tipo));

    for (const tipo of TIPOS_BUSCA) {
      expect(TIPO_BUSCA_INFO[tipo].singular.length).toBeGreaterThan(0);
      expect(TIPO_BUSCA_INFO[tipo].plural.length).toBeGreaterThan(0);
      expect(TIPO_BUSCA_INFO[tipo].descricao.length).toBeGreaterThan(0);
      expect(ancoras.filter((a) => a === ancoraDoTipo(tipo))).toHaveLength(1);
    }
  });
});

describe('segurança para o bundle do cliente', () => {
  it('não importa o Prisma (o arquivo é consumido por componente client)', () => {
    const fonte = readFileSync(new URL('../src/lib/busca-filtros.ts', import.meta.url), 'utf8');

    expect(fonte).not.toMatch(/['"]@\/lib\/prisma['"]/);
    expect(fonte).not.toMatch(/['"]@prisma\/client['"]/);
  });
});
