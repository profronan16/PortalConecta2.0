import { describe, it, expect } from 'vitest';
import {
  normalizarEntidade,
  chaveFavorito,
  hrefFavorito,
  normalizarCategoriasAlerta,
  validarAlerta,
  canalAlertaValido,
  editalInteressaAoAlerta,
  resumoCategoriasAlerta,
  contarNaoLidas,
  rotuloContadorNaoLidas,
  formatarTempoRelativo,
  CATEGORIAS_ALERTA,
} from '@/lib/minha-area';

/**
 * Testes dos itens 6.2/6.3/6.4 — regras puras de favoritos, alertas e
 * notificações da área do estudante.
 *
 * O que importa blindar aqui: validação do que vem do cliente (entidade, canal,
 * categorias) e a decisão de "este edital interessa a este alerta", que é o
 * filtro usado no disparo dos avisos.
 */

describe('favoritos — entidade e URLs', () => {
  it('aceita apenas projeto e edital', () => {
    expect(normalizarEntidade('projeto')).toBe('projeto');
    expect(normalizarEntidade('EDITAL')).toBe('edital');
    expect(normalizarEntidade(' edital ')).toBe('edital');
  });

  it('rejeita qualquer outra coisa (inclusive injeção de texto)', () => {
    expect(normalizarEntidade('usuarios')).toBeNull();
    expect(normalizarEntidade('projeto; drop table')).toBeNull();
    expect(normalizarEntidade(null)).toBeNull();
    expect(normalizarEntidade(42)).toBeNull();
  });

  it('usa chave estável para o estado no cliente', () => {
    expect(chaveFavorito('projeto', 'abc')).toBe('projeto:abc');
  });

  it('monta o destino conforme a entidade', () => {
    expect(hrefFavorito('projeto', 'horta')).toBe('/projetos/horta');
    expect(hrefFavorito('edital', '2026-01')).toBe('/editais/2026-01');
  });
});

describe('alertas — validação do que vem do cliente', () => {
  it('aceita somente canais suportados', () => {
    expect(canalAlertaValido('portal')).toBe(true);
    expect(canalAlertaValido('email')).toBe(true);
    // whatsapp existe no schema, mas não há integração implementada
    expect(canalAlertaValido('whatsapp')).toBe(false);
    expect(canalAlertaValido(undefined)).toBe(false);
  });

  it('normaliza categorias: descarta inválidas, remove repetição e ordena', () => {
    expect(
      normalizarCategoriasAlerta(['PESQUISA', 'pesquisa', 'BOLSAS', 'INVENTADO', '  ']),
    ).toEqual(['BOLSAS', 'PESQUISA']);
  });

  it('lista vazia ou não-array vira lista vazia (= todas as categorias)', () => {
    expect(normalizarCategoriasAlerta([])).toEqual([]);
    expect(normalizarCategoriasAlerta('BOLSAS')).toEqual([]);
    expect(normalizarCategoriasAlerta(undefined)).toEqual([]);
  });

  it('devolve a ordem canônica, não a ordem enviada', () => {
    const resultado = normalizarCategoriasAlerta(['RESULTADOS', 'BOLSAS']);

    expect(resultado).toEqual(
      CATEGORIAS_ALERTA.filter((c) => c === 'BOLSAS' || c === 'RESULTADOS'),
    );
  });

  it('recusa canal inválido com mensagem clara', () => {
    const resultado = validarAlerta({ canal: 'telegram', categorias: ['BOLSAS'] });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toContain('Canal inválido');
  });

  it('aceita alerta válido preservando canal e categorias normalizadas', () => {
    const resultado = validarAlerta({ canal: 'email', categorias: ['extensao'] });

    expect(resultado).toEqual({ ok: true, canal: 'email', categorias: ['EXTENSAO'] });
  });
});

describe('editalInteressaAoAlerta', () => {
  it('alerta sem categorias recebe tudo', () => {
    expect(editalInteressaAoAlerta('BOLSAS', [])).toBe(true);
    expect(editalInteressaAoAlerta(null, [])).toBe(true);
  });

  it('alerta com categorias só recebe as suas', () => {
    expect(editalInteressaAoAlerta('BOLSAS', ['BOLSAS', 'PESQUISA'])).toBe(true);
    expect(editalInteressaAoAlerta('EVENTOS', ['BOLSAS', 'PESQUISA'])).toBe(false);
  });

  it('edital sem categoria não casa com alerta específico', () => {
    expect(editalInteressaAoAlerta(null, ['BOLSAS'])).toBe(false);
  });
});

describe('resumoCategoriasAlerta', () => {
  it('descreve lista vazia como todas as categorias', () => {
    expect(resumoCategoriasAlerta([])).toBe('Todas as categorias');
  });

  it('usa os rótulos legíveis', () => {
    expect(resumoCategoriasAlerta(['BOLSAS', 'EXTENSAO'])).toBe('Bolsas, Extensão');
  });
});

describe('notificações — contador', () => {
  it('conta apenas as não lidas', () => {
    expect(contarNaoLidas([{ lida: false }, { lida: true }, { lida: false }])).toBe(2);
    expect(contarNaoLidas([])).toBe(0);
  });

  it('esconde o badge quando não há nada pendente', () => {
    expect(rotuloContadorNaoLidas(0)).toBeNull();
    expect(rotuloContadorNaoLidas(-1)).toBeNull();
  });

  it('mostra o número e limita em 99+', () => {
    expect(rotuloContadorNaoLidas(3)).toBe('3');
    expect(rotuloContadorNaoLidas(99)).toBe('99');
    expect(rotuloContadorNaoLidas(150)).toBe('99+');
  });
});

describe('formatarTempoRelativo', () => {
  const agora = new Date('2026-09-16T12:00:00Z');

  it('mostra "agora" para menos de um minuto', () => {
    expect(formatarTempoRelativo(new Date('2026-09-16T11:59:30Z'), agora)).toBe('agora');
  });

  it('mostra minutos e horas', () => {
    expect(formatarTempoRelativo(new Date('2026-09-16T11:45:00Z'), agora)).toBe('há 15 min');
    expect(formatarTempoRelativo(new Date('2026-09-16T09:00:00Z'), agora)).toBe('há 3 h');
  });

  it('usa "ontem" e depois dias', () => {
    expect(formatarTempoRelativo(new Date('2026-09-15T09:00:00Z'), agora)).toBe('ontem');
    expect(formatarTempoRelativo(new Date('2026-09-13T09:00:00Z'), agora)).toBe('há 3 dias');
  });

  it('cai para a data completa depois de 30 dias', () => {
    expect(formatarTempoRelativo(new Date('2026-07-01T12:00:00Z'), agora)).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('não quebra com data inválida', () => {
    expect(formatarTempoRelativo('não é data', agora)).toBe('');
  });
});
