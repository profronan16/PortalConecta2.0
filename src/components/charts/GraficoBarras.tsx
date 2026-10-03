'use client';

import {
  escalaLimite,
  formatarNumero,
  maximoSerie,
  ticksEixo,
  truncarRotulo,
} from '@/lib/relatorios-series';
import { CORES_GRAFICO, corDoRotulo } from './paleta';
import { descreverSerie, type DadoGrafico } from './comum';

/**
 * Gráfico de barras verticais em SVG puro (ROADMAP 6.7).
 *
 * Sem biblioteca de gráficos de propósito: o projeto não tem nenhuma instalada e
 * o item 6.7 proíbe adicionar dependência. SVG inline resolve os dois casos
 * deste portal (6 status e 12 meses) sem custo de bundle.
 *
 * Acessibilidade: `role="img"` + `aria-label` com a série completa em texto e um
 * `<title>` dentro de cada barra (tooltip nativa, sem JS).
 */

type Props = {
  dados: DadoGrafico[];
  /** Título do gráfico: vira o `<title>` do SVG e o começo do `aria-label`. */
  titulo: string;
  /** Unidade exibida no texto acessível (ex.: "inscrições"). */
  unidade?: string;
  /** Altura da área de plotagem, em unidades do viewBox (o SVG escala inteiro). */
  altura?: number;
  /** Texto mostrado quando não há categorias. */
  textoVazio?: string;
  className?: string;
};

/** Largura fixa do viewBox — o `w-full` do CSS cuida do tamanho real. */
const LARGURA = 720;
const MARGEM = { topo: 18, direita: 16, base: 54, esquerda: 46 };
/** Altura mínima desenhada para valor zero: sinaliza a categoria sem mentir o dado. */
const ALTURA_ZERO = 2;

export default function GraficoBarras({
  dados,
  titulo,
  unidade,
  altura = 220,
  textoVazio = 'Sem dados para exibir.',
  className,
}: Props) {
  const pontos = (dados ?? []).filter(Boolean);

  if (pontos.length === 0) {
    return (
      <p className={`text-sm text-gray-400 py-8 text-center ${className ?? ''}`}>{textoVazio}</p>
    );
  }

  const alturaTotal = altura + MARGEM.topo + MARGEM.base;
  const larguraPlot = LARGURA - MARGEM.esquerda - MARGEM.direita;
  const baseY = MARGEM.topo + altura;

  const limite = escalaLimite(maximoSerie(pontos));
  const ticks = ticksEixo(limite, 4);
  const banda = larguraPlot / pontos.length;
  const larguraBarra = Math.max(6, Math.min(56, banda * 0.62));

  const descricao = descreverSerie(pontos, { unidade });
  const ariaLabel = `${titulo}. ${descricao}`;

  return (
    <svg
      viewBox={`0 0 ${LARGURA} ${alturaTotal}`}
      width="100%"
      className={`w-full h-auto ${className ?? ''}`}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{ariaLabel}</title>

      {/* Grade + eixo Y */}
      {ticks.map((tick) => {
        const y = baseY - (tick / limite) * altura;
        return (
          <g key={`tick-${tick}`}>
            <line
              x1={MARGEM.esquerda}
              x2={LARGURA - MARGEM.direita}
              y1={y}
              y2={y}
              stroke={CORES_GRAFICO.grade}
              strokeWidth={1}
            />
            <text
              x={MARGEM.esquerda - 8}
              y={y + 4}
              textAnchor="end"
              fontSize={11}
              fill={CORES_GRAFICO.texto}
            >
              {formatarNumero(tick)}
            </text>
          </g>
        );
      })}

      {/* Barras */}
      {pontos.map((ponto, indice) => {
        const valor = Number.isFinite(ponto.valor) ? ponto.valor : 0;
        const alturaBarra = (valor / limite) * altura;
        const x = MARGEM.esquerda + banda * indice + (banda - larguraBarra) / 2;
        const y = baseY - Math.max(alturaBarra, valor > 0 ? 0 : ALTURA_ZERO);
        const cor = ponto.cor ?? corDoRotulo(ponto.rotulo, indice);
        const detalhe = `${ponto.rotulo}: ${formatarNumero(valor)}${
          unidade ? ` ${unidade}` : ''
        }${typeof ponto.percentual === 'number' ? ` (${ponto.percentual}%)` : ''}`;

        return (
          <g key={`${ponto.rotulo}-${indice}`}>
            <rect
              x={x}
              y={y}
              width={larguraBarra}
              height={Math.max(alturaBarra, ALTURA_ZERO)}
              rx={4}
              fill={valor > 0 ? cor : CORES_GRAFICO.grade}
            >
              <title>{detalhe}</title>
            </rect>

            {/* Valor acima da barra: o gráfico tem que ser legível sem hover. */}
            <text
              x={x + larguraBarra / 2}
              y={y - 6}
              textAnchor="middle"
              fontSize={12}
              fontWeight={600}
              fill={CORES_GRAFICO.textoTitulo}
            >
              {valor > 0 ? formatarNumero(valor) : ''}
            </text>

            <text
              x={x + larguraBarra / 2}
              y={baseY + 20}
              textAnchor="middle"
              fontSize={11}
              fill={CORES_GRAFICO.texto}
            >
              {truncarRotulo(ponto.rotulo, Math.max(6, Math.floor(banda / 6.4)))}
              <title>{ponto.rotulo}</title>
            </text>
          </g>
        );
      })}

      {/* Linha de base */}
      <line
        x1={MARGEM.esquerda}
        x2={LARGURA - MARGEM.direita}
        y1={baseY}
        y2={baseY}
        stroke={CORES_GRAFICO.neutro}
        strokeWidth={1}
      />
    </svg>
  );
}
