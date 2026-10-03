/**
 * Tipos e textos compartilhados pelos gráficos SVG (ROADMAP 6.7).
 *
 * Sem JSX aqui de propósito: é o módulo dos gráficos importável por qualquer
 * código (client component ou helper puro).
 */
import { formatarNumero, formatarPercentual } from '@/lib/relatorios-series';

/** Ponto já pronto para desenhar — o mesmo formato usado nas séries de `relatorios-series`. */
export type DadoGrafico = {
  rotulo: string;
  valor: number;
  /** Percentual sobre o total da série; quando ausente o gráfico recalcula. */
  percentual?: number;
  /** Sobrescreve a cor padrão do rótulo. */
  cor?: string;
};

/**
 * Texto acessível do gráfico — é o que o leitor de tela anuncia no `aria-label`
 * e o que aparece no `<title>` do SVG (tooltip nativa do navegador).
 *
 * Ex.: "Recebida: 12 (30%); Em análise: 5 (12,5%)".
 */
export function descreverSerie(
  dados: readonly DadoGrafico[],
  opcoes: { unidade?: string; incluirPercentual?: boolean } = {},
): string {
  if (!dados || dados.length === 0) return 'Sem dados para exibir.';

  const comPercentual =
    opcoes.incluirPercentual ?? dados.some((dado) => typeof dado?.percentual === 'number');

  const partes = dados.map((dado) => {
    const valor = `${formatarNumero(dado.valor)}${opcoes.unidade ? ` ${opcoes.unidade}` : ''}`;
    if (!comPercentual || typeof dado.percentual !== 'number') {
      return `${dado.rotulo}: ${valor}`;
    }
    return `${dado.rotulo}: ${valor} (${formatarPercentual(dado.percentual)})`;
  });

  return partes.join('; ');
}

/** Soma dos valores da série (usada para recalcular percentuais no donut). */
export function totalDaSerie(dados: readonly DadoGrafico[]): number {
  return (dados ?? []).reduce(
    (acc, dado) => acc + (Number.isFinite(dado?.valor) ? dado.valor : 0),
    0,
  );
}
