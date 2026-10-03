'use client';

import { formatarNumero, formatarPercentual, maximoSerie, truncarRotulo } from '@/lib/relatorios-series';
import { CORES_GRAFICO, corDoRotulo } from './paleta';
import { descreverSerie, type DadoGrafico } from './comum';

/**
 * Barras horizontais em SVG puro (ROADMAP 6.7).
 *
 * Usado onde o rótulo é longo (área do projeto, nome do projeto): na vertical o
 * texto teria que ser rotacionado ou truncado demais para caber.
 */

type Props = {
  dados: DadoGrafico[];
  titulo: string;
  unidade?: string;
  /**
   * Texto exibido à direita de cada barra. Padrão: o valor formatado.
   * Ex.: vagas → `(dado) => \`${dado.valor}/10\``.
   */
  formatarValor?: (dado: DadoGrafico) => string;
  /** Denominador da largura da barra; por padrão, o maior valor da série. */
  maximo?: number;
  textoVazio?: string;
  className?: string;
};

const LARGURA = 720;
const ALTURA_LINHA = 30;
const X_TRILHO = 200;
const LARGURA_TRILHO = 440;
const ALTURA_BARRA = 14;

export default function GraficoBarrasHorizontais({
  dados,
  titulo,
  unidade,
  formatarValor,
  maximo,
  textoVazio = 'Sem dados para exibir.',
  className,
}: Props) {
  const pontos = (dados ?? []).filter(Boolean);

  if (pontos.length === 0) {
    return (
      <p className={`text-sm text-gray-400 py-8 text-center ${className ?? ''}`}>{textoVazio}</p>
    );
  }

  const alturaTotal = pontos.length * ALTURA_LINHA + 8;
  const teto = Math.max(
    1,
    Number.isFinite(maximo ?? Number.NaN) ? (maximo as number) : maximoSerie(pontos),
  );

  const descricao = descreverSerie(pontos, { unidade, incluirPercentual: true });
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

      {pontos.map((ponto, indice) => {
        const valor = Number.isFinite(ponto.valor) ? ponto.valor : 0;
        const cor = ponto.cor ?? corDoRotulo(ponto.rotulo, indice);
        const fracao = Math.min(valor / teto, 1);
        const y = indice * ALTURA_LINHA + 8;
        const textoValor = formatarValor
          ? formatarValor(ponto)
          : `${formatarNumero(valor)}${typeof ponto.percentual === 'number' ? ` (${formatarPercentual(ponto.percentual)})` : ''}`;

        return (
          <g key={`${ponto.rotulo}-${indice}`}>
            <text
              x={X_TRILHO - 12}
              y={y + ALTURA_BARRA / 2 + 4}
              textAnchor="end"
              fontSize={12}
              fill={CORES_GRAFICO.textoTitulo}
            >
              {truncarRotulo(ponto.rotulo, 30)}
              <title>{ponto.rotulo}</title>
            </text>

            <rect
              x={X_TRILHO}
              y={y}
              width={LARGURA_TRILHO}
              height={ALTURA_BARRA}
              rx={7}
              fill={CORES_GRAFICO.trilho}
            />

            <rect
              x={X_TRILHO}
              y={y}
              width={Math.max(fracao * LARGURA_TRILHO, valor > 0 ? 4 : 0)}
              height={ALTURA_BARRA}
              rx={7}
              fill={cor}
            >
              <title>{`${ponto.rotulo}: ${formatarNumero(valor)}${
                unidade ? ` ${unidade}` : ''
              }${typeof ponto.percentual === 'number' ? ` (${formatarPercentual(ponto.percentual)})` : ''}`}</title>
            </rect>

            <text
              x={X_TRILHO + LARGURA_TRILHO + 12}
              y={y + ALTURA_BARRA / 2 + 4}
              fontSize={11}
              fill={CORES_GRAFICO.texto}
            >
              {textoValor}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
