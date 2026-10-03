import { describe, it, expect } from 'vitest';
import {
  STATUS_INSCRICAO,
  ROTULOS_STATUS_INSCRICAO,
  AREA_NAO_INFORMADA,
  numeroSeguro,
  somarValores,
  arredondarPercentual,
  calcularPercentual,
  comPercentuais,
  maximoSerie,
  passoAgradavel,
  escalaLimite,
  ticksEixo,
  ordenarPorValor,
  agruparContagens,
  limitarComOutros,
  mesChave,
  mesCurto,
  normalizarChaveMes,
  ultimosMeses,
  preencherSerieMensal,
  contagensParaMapa,
  montarSerieStatus,
  montarSerieCategoriasEdital,
  taxaOcupacao,
  montarSerieVagas,
  formatarNumero,
  formatarPercentual,
  truncarRotulo,
  rotuloStatusInscricao,
  rotuloCategoriaEdital,
} from '@/lib/relatorios-series';

/**
 * Testes do item 6.7 — "Relatórios avançados com gráficos".
 *
 * O foco é a camada pura (`src/lib/relatorios-series.ts`), porque é ela que
 * garante que um projeto sem nenhuma inscrição não gere `NaN` dentro do SVG e
 * que a série mensal não esconda meses vazios.
 */

describe('numeroSeguro', () => {
  it('devolve 0 para entradas inválidas em vez de NaN', () => {
    expect(numeroSeguro(undefined)).toBe(0);
    expect(numeroSeguro(null)).toBe(0);
    expect(numeroSeguro(Number.NaN)).toBe(0);
    expect(numeroSeguro(Number.POSITIVE_INFINITY)).toBe(0);
    expect(numeroSeguro('abc')).toBe(0);
    expect(numeroSeguro('')).toBe(0);
    expect(numeroSeguro(-7)).toBe(0);
  });

  it('aceita números, strings numéricas e bigint (o driver devolve count como bigint)', () => {
    expect(numeroSeguro(12)).toBe(12);
    expect(numeroSeguro('12')).toBe(12);
    expect(numeroSeguro(10n)).toBe(10);
    expect(numeroSeguro(0)).toBe(0);
  });

  it('usa o fallback informado quando a entrada é inválida', () => {
    expect(numeroSeguro(undefined, 1)).toBe(1);
    expect(numeroSeguro(Number.NaN, 5)).toBe(5);
  });
});

describe('calcularPercentual / comPercentuais', () => {
  it('total zero devolve 0 — nunca NaN nem Infinity', () => {
    const percentual = calcularPercentual(0, 0);

    expect(percentual).toBe(0);
    expect(Number.isNaN(percentual)).toBe(false);
    expect(Number.isFinite(percentual)).toBe(true);
    expect(calcularPercentual(5, 0)).toBe(0);
  });

  it('arredonda para 1 casa decimal', () => {
    expect(calcularPercentual(1, 3)).toBe(33.3);
    expect(calcularPercentual(2, 3)).toBe(66.7);
    expect(calcularPercentual(1, 4)).toBe(25);
    expect(arredondarPercentual(33.33333)).toBe(33.3);
    expect(arredondarPercentual(33.33333, 2)).toBe(33.33);
  });

  it('comPercentuais calcula cada fatia sobre o total da série', () => {
    const serie = comPercentuais([
      { rotulo: 'Selecionado', valor: 3 },
      { rotulo: 'Recebida', valor: 1 },
    ]);

    expect(serie).toEqual([
      { rotulo: 'Selecionado', valor: 3, percentual: 75 },
      { rotulo: 'Recebida', valor: 1, percentual: 25 },
    ]);
  });

  it('série totalmente zerada devolve percentuais zerados (caso do projeto novo)', () => {
    const serie = comPercentuais([
      { rotulo: 'Recebida', valor: 0 },
      { rotulo: 'Selecionado', valor: 0 },
    ]);

    expect(serie.every((p) => p.percentual === 0)).toBe(true);
    expect(serie.every((p) => Number.isFinite(p.percentual))).toBe(true);
  });

  it('somarValores ignora entradas inválidas', () => {
    expect(somarValores([{ valor: 2 }, { valor: 3 }])).toBe(5);
    expect(somarValores([])).toBe(0);
  });
});

describe('escalas do gráfico de barras', () => {
  it('maximoSerie nunca devolve 0 (evita divisão por zero na altura da barra)', () => {
    expect(maximoSerie([])).toBe(1);
    expect(maximoSerie([0, 0, 0])).toBe(1);
    expect(maximoSerie([{ valor: 0 }])).toBe(1);
  });

  it('maximoSerie respeita o piso informado e o maior valor da série', () => {
    expect(maximoSerie([3, 9, 7])).toBe(9);
    expect(maximoSerie([1, 2], 5)).toBe(5);
    expect(maximoSerie([{ valor: 12 }, { valor: 4 }])).toBe(12);
  });

  it('passoAgradavel arredonda para múltiplos legíveis', () => {
    expect(passoAgradavel(1.75)).toBe(2);
    expect(passoAgradavel(25)).toBe(25);
    expect(passoAgradavel(0.25)).toBe(0.25);
    expect(passoAgradavel(0)).toBe(1);
  });

  it('escalaLimite fecha a escala em um valor redondo >= máximo', () => {
    expect(escalaLimite(7)).toBe(8);
    expect(escalaLimite(100)).toBe(100);
    expect(escalaLimite(0)).toBe(4);
    expect(escalaLimite(0, 5)).toBe(5);
    expect(escalaLimite(3)).toBe(4);
    expect(escalaLimite(43)).toBeGreaterThanOrEqual(43);
  });

  it('ticksEixo vai de 0 ao limite com passos iguais', () => {
    expect(ticksEixo(8)).toEqual([0, 2, 4, 6, 8]);
    expect(ticksEixo(100)).toEqual([0, 25, 50, 75, 100]);
    expect(ticksEixo(4)).toEqual([0, 1, 2, 3, 4]);
    expect(ticksEixo(0)).toEqual([0]);
  });
});

describe('ordenação de séries', () => {
  const serie = [
    { rotulo: 'Extensão', valor: 5 },
    { rotulo: 'Pesquisa', valor: 12 },
    { rotulo: 'Ensino', valor: 5 },
  ];

  it('ordena do maior para o menor por padrão', () => {
    expect(ordenarPorValor(serie).map((p) => p.rotulo)).toEqual([
      'Pesquisa', 'Extensão', 'Ensino',
    ]);
  });

  it('ordena do menor para o maior quando pedido', () => {
    expect(ordenarPorValor(serie, 'asc').map((p) => p.rotulo)).toEqual([
      'Extensão', 'Ensino', 'Pesquisa',
    ]);
  });

  it('empates preservam a ordem de entrada (sort estável)', () => {
    expect(ordenarPorValor(serie).slice(1).map((p) => p.rotulo)).toEqual(['Extensão', 'Ensino']);
  });

  it('não muta o array recebido — a mesma lista é reusada em outras seções da página', () => {
    const original = [...serie];
    ordenarPorValor(serie);
    expect(serie).toEqual(original);
  });
});

describe('agrupamento e corte de categorias', () => {
  it('junta rótulos vazios (Projeto.area é String @default(""))', () => {
    const agrupado = agruparContagens([
      { rotulo: '', valor: 2 },
      { rotulo: '   ', valor: 3 },
      { rotulo: 'Pesquisa', valor: 1 },
    ]);

    expect(agrupado).toEqual([
      { rotulo: AREA_NAO_INFORMADA, valor: 5 },
      { rotulo: 'Pesquisa', valor: 1 },
    ]);
  });

  it('soma rótulos repetidos preservando a primeira aparição', () => {
    expect(agruparContagens([
      { rotulo: 'Ensino', valor: 2 },
      { rotulo: 'Ensino', valor: 3 },
    ])).toEqual([{ rotulo: 'Ensino', valor: 5 }]);
  });

  it('limitarComOutros mantém o topo e soma a cauda', () => {
    const cortado = limitarComOutros(
      [
        { rotulo: 'A', valor: 10 },
        { rotulo: 'B', valor: 8 },
        { rotulo: 'C', valor: 5 },
        { rotulo: 'D', valor: 2 },
      ],
      3,
    );

    expect(cortado).toEqual([
      { rotulo: 'A', valor: 10 },
      { rotulo: 'B', valor: 8 },
      { rotulo: 'Outros', valor: 7 },
    ]);
  });

  it('limitarComOutros não cria "Outros" quando tudo cabe', () => {
    const lista = [{ rotulo: 'A', valor: 1 }];
    expect(limitarComOutros(lista, 5)).toEqual(lista);
    expect(limitarComOutros(lista, 0)).toEqual([]);
  });
});

describe('séries mensais', () => {
  const referencia = new Date(2025, 6, 15); // julho/2025 (mês local)

  it('mesChave usa o mês local, com zero à esquerda', () => {
    expect(mesChave(new Date(2025, 0, 31))).toBe('2025-01');
    expect(mesChave('2024-12-01T12:00:00')).toBe('2024-12');
    expect(mesChave('data-invalida')).toBe('');
  });

  it('mesCurto encurta o rótulo do eixo', () => {
    expect(mesCurto('2025-01')).toBe('jan/25');
    expect(mesCurto('2024-12')).toBe('dez/24');
    expect(mesCurto('qualquer')).toBe('qualquer');
  });

  it('normalizarChaveMes aceita YYYY-MM, YYYY-MM-DD e Date', () => {
    expect(normalizarChaveMes('2025-03')).toBe('2025-03');
    expect(normalizarChaveMes('2025-03-09')).toBe('2025-03');
    expect(normalizarChaveMes(new Date(2025, 2, 9))).toBe('2025-03');
    expect(normalizarChaveMes('')).toBe('');
  });

  it('ultimosMeses devolve a janela cronológica terminando na referência', () => {
    expect(ultimosMeses(3, referencia)).toEqual(['2025-05', '2025-06', '2025-07']);
    expect(ultimosMeses(0, referencia)).toEqual([]);
  });

  it('ultimosMeses atravessa a virada de ano', () => {
    expect(ultimosMeses(3, new Date(2025, 0, 10))).toEqual(['2024-11', '2024-12', '2025-01']);
  });

  it('preenche com 0 os meses sem inscrição (o gráfico não pode "pular" meses)', () => {
    const serie = preencherSerieMensal(
      [
        { periodo: '2025-07', total: 4 },
        { periodo: '2025-05', total: 2 },
      ],
      { quantidade: 4, referencia },
    );

    expect(serie).toEqual([
      { rotulo: 'abr/25', valor: 0 },
      { rotulo: 'mai/25', valor: 2 },
      { rotulo: 'jun/25', valor: 0 },
      { rotulo: 'jul/25', valor: 4 },
    ]);
  });

  it('ignora meses fora da janela e soma períodos repetidos', () => {
    const serie = preencherSerieMensal(
      [
        { periodo: '2020-01', total: 99 },
        { periodo: '2025-06', total: 1 },
        { periodo: '2025-06', total: 2 },
        { periodo: '2025-06-30', total: 3 },
      ],
      { quantidade: 2, referencia },
    );

    expect(serie).toEqual([
      { rotulo: 'jun/25', valor: 6 },
      { rotulo: 'jul/25', valor: 0 },
    ]);
  });

  it('lista vazia de contagens produz uma série só de zeros', () => {
    const serie = preencherSerieMensal([], { quantidade: 3, referencia });

    expect(serie.map((p) => p.valor)).toEqual([0, 0, 0]);
    expect(serie.every((p) => Number.isFinite(p.valor))).toBe(true);
  });
});

describe('montarSerieStatus', () => {
  it('mantém os seis status na ordem canônica, com percentuais', () => {
    const serie = montarSerieStatus({ selecionado: 3, recebida: 1 });

    expect(serie.map((p) => p.rotulo)).toEqual(
      STATUS_INSCRICAO.map((s) => ROTULOS_STATUS_INSCRICAO[s]),
    );
    expect(serie[0]).toEqual({ rotulo: 'Recebida', valor: 1, percentual: 25 });
    expect(serie.find((p) => p.rotulo === 'Selecionado')).toEqual({
      rotulo: 'Selecionado', valor: 3, percentual: 75,
    });
  });

  it('incluirZeros: false remove os status sem inscrição', () => {
    const serie = montarSerieStatus({ selecionado: 2 }, { incluirZeros: false });

    expect(serie).toEqual([{ rotulo: 'Selecionado', valor: 2, percentual: 100 }]);
  });

  it('status desconhecido (dado legado) não desaparece do relatório', () => {
    const serie = montarSerieStatus({ selecionado: 1, cancelada_pelo_aluno: 2 });

    expect(serie[serie.length - 1]).toEqual({
      rotulo: 'cancelada pelo aluno', valor: 2, percentual: 66.7,
    });
  });

  it('mapa vazio não gera NaN', () => {
    const serie = montarSerieStatus({});

    expect(serie).toHaveLength(STATUS_INSCRICAO.length);
    expect(serie.every((p) => p.valor === 0 && p.percentual === 0)).toBe(true);
  });

  it('contagensParaMapa consolida a lista do groupBy', () => {
    expect(contagensParaMapa([
      { rotulo: 'recebida', valor: 2 },
      { rotulo: 'recebida', valor: 1 },
      { rotulo: 'selecionado', valor: 4 },
    ])).toEqual({ recebida: 3, selecionado: 4 });
  });
});

describe('montarSerieCategoriasEdital', () => {
  it('usa a ordem canônica das categorias e ignora as vazias por padrão', () => {
    const serie = montarSerieCategoriasEdital({ PESQUISA: 1, BOLSAS: 3 });

    expect(serie).toEqual([
      { rotulo: 'Bolsas', valor: 3, percentual: 75 },
      { rotulo: 'Pesquisa', valor: 1, percentual: 25 },
    ]);
  });

  it('com incluirZeros mantém todas as categorias do enum', () => {
    const serie = montarSerieCategoriasEdital({ BOLSAS: 2 }, { incluirZeros: true });

    expect(serie).toHaveLength(8);
    expect(serie.filter((p) => p.valor > 0)).toHaveLength(1);
  });

  it('rótulos de categoria são traduzidos', () => {
    expect(rotuloCategoriaEdital('AUXILIOS')).toBe('Auxílios');
    expect(rotuloCategoriaEdital('EXTENSAO')).toBe('Extensão');
    expect(rotuloCategoriaEdital('DESCONHECIDA')).toBe('DESCONHECIDA');
    expect(rotuloStatusInscricao('em_analise')).toBe('Em análise');
    expect(rotuloStatusInscricao('lista_espera')).toBe('Lista de espera');
    expect(rotuloStatusInscricao('outro_status')).toBe('outro status');
  });
});

describe('vagas preenchidas', () => {
  it('taxaOcupacao devolve 0 quando não há vagas ofertadas', () => {
    expect(taxaOcupacao(0, 0)).toBe(0);
    expect(taxaOcupacao(3, 0)).toBe(0);
    expect(Number.isNaN(taxaOcupacao(3, 0))).toBe(false);
  });

  it('taxaOcupacao não passa de 100% (mais selecionados que vagas)', () => {
    expect(taxaOcupacao(1, 4)).toBe(25);
    expect(taxaOcupacao(4, 4)).toBe(100);
    expect(taxaOcupacao(9, 4)).toBe(100);
  });

  it('montarSerieVagas ordena pelo percentual de ocupação', () => {
    const serie = montarSerieVagas([
      { rotulo: 'Horta', preenchidas: 1, total: 10 },
      { rotulo: 'Robótica', preenchidas: 4, total: 4 },
      { rotulo: 'Xadrez', preenchidas: 3, total: 6 },
    ]);

    expect(serie.map((v) => v.rotulo)).toEqual(['Robótica', 'Xadrez', 'Horta']);
    expect(serie.map((v) => v.percentual)).toEqual([100, 50, 10]);
  });

  it('projeto sem vagas não vira NaN', () => {
    const serie = montarSerieVagas([{ rotulo: 'Novo', preenchidas: 0, total: 0 }]);

    expect(serie[0]).toEqual({ rotulo: 'Novo', preenchidas: 0, total: 0, percentual: 0 });
  });
});

describe('formatação', () => {
  it('formatarNumero usa separador de milhar pt-BR', () => {
    expect(formatarNumero(0)).toBe('0');
    expect(formatarNumero(42)).toBe('42');
    expect(formatarNumero(1234)).toBe('1.234');
    expect(formatarNumero(Number.NaN)).toBe('0');
  });

  it('formatarPercentual usa vírgula decimal', () => {
    expect(formatarPercentual(25)).toBe('25%');
    expect(formatarPercentual(33.333)).toBe('33,3%');
    expect(formatarPercentual(0)).toBe('0%');
  });

  it('truncarRotulo encurta rótulos longos sem perder os curtos', () => {
    expect(truncarRotulo('Extensão', 14)).toBe('Extensão');
    expect(truncarRotulo('Desenvolvimento de Sistemas', 12)).toHaveLength(12);
    expect(truncarRotulo('Desenvolvimento de Sistemas', 12).endsWith('…')).toBe(true);
    expect(truncarRotulo('   ', 5)).toBe('');
  });
});
