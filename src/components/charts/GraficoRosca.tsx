'use client';

import { calcularPercentual, formatarNumero, formatarPercentual } from '@/lib/relatorios-series';
import { CORES_GRAFICO, corDoRotulo } from './paleta';
import { descreverSerie, totalDaSerie, type DadoGrafico } from './comum';

/**
 * Gráfico de rosca (donut) em SVG puro para distribuições percentuais
 * (ROADMAP 6.7) — usado para inscrições por status e editais por categoria.
 *
 * Truque central: `pathLength={100}` normaliza a circunferência do círculo para
 * 100 unidades, então `stroke-dasharray` pode ser escrito direto em percentual,
 * sem calcular arco/`d` na mão. Isso mantém o componente curto e sem
 * dependência de trigonometria.
 *
 * A legenda fica em HTML (não dentro do SVG) para o texto acompanhar o layout e
 * continuar selecionável/legível por leitores de tela.
 */

type Props = {
  dados: DadoGrafico[];
  titulo: string;
  unidade?: string;
  /** Diâmetro do círculo, em unidades do viewBox. */
  tamanho?: number;
  /** Espessura do anel, em unidades do viewBox. */
  espessura?: number;
  /** Rótulo pequeno abaixo do número central (ex.: "inscrições"). */
  rotuloCentro?: string;
  textoVazio?: string;
  className?: string;
};

export default function GraficoRosca({
  dados,
  titulo,
  unidade,
  tamanho = 220,
  espessura = 34,
  rotuloCentro,
  textoVazio = 'Sem dados para exibir.',
  className,
}: Props) {
  const pontos = (dados ?? []).filter(Boolean);
  const total = totalDaSerie(pontos);

  if (pontos.length === 0 || total <= 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-8 ${className ?? ''}`}>
        <svg
          viewBox={`0 0 ${tamanho} ${tamanho}`}
          width="100%"
          className="w-full h-auto max-w-[200px]"
          role="img"
          aria-label={`${titulo}. ${textoVazio}`}
        >
          <title>{`${titulo}. ${textoVazio}`}</title>
          <circle
            cx={tamanho / 2}
            cy={tamanho / 2}
            r={(tamanho - espessura) / 2}
            fill="none"
            stroke={CORES_GRAFICO.trilho}
            strokeWidth={espessura}
          />
        </svg>
        <p className="text-sm text-gray-400 mt-2">{textoVazio}</p>
      </div>
    );
  }

  const raio = (tamanho - espessura) / 2;
  const centro = tamanho / 2;

  // Percentuais já arredondados (o mesmo número da legenda e do aria-label; sem
  // isso a legenda e a fatia poderiam discordar por arredondamentos diferentes).
  const fatias = pontos.map((ponto, indice) => ({
    ...ponto,
    cor: ponto.cor ?? corDoRotulo(ponto.rotulo, indice),
    percentual:
      typeof ponto.percentual === 'number'
        ? ponto.percentual
        : calcularPercentual(ponto.valor, total),
  }));

  const descricao = descreverSerie(fatias, { unidade, incluirPercentual: true });
  const ariaLabel = `${titulo}. Total: ${formatarNumero(total)}${
    unidade ? ` ${unidade}` : ''
  }. ${descricao}`;

  let acumulado = 0;

  return (
    <figure className={`flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6 ${className ?? ''}`}>
      <svg
        viewBox={`0 0 ${tamanho} ${tamanho}`}
        width="100%"
        className="w-full h-auto max-w-[200px] shrink-0"
        role="img"
        aria-label={ariaLabel}
      >
        <title>{ariaLabel}</title>

        {/* Trilho: mantém o anel visível mesmo com uma única fatia de 100%. */}
        <circle
          cx={centro}
          cy={centro}
          r={raio}
          fill="none"
          stroke={CORES_GRAFICO.trilho}
          strokeWidth={espessura}
        />

        <g transform={`rotate(-90 ${centro} ${centro})`}>
          {fatias.map((fatia, indice) => {
            const deslocamento = acumulado;
            acumulado += fatia.percentual;
            const detalhe = `${fatia.rotulo}: ${formatarNumero(fatia.valor)}${
              unidade ? ` ${unidade}` : ''
            } (${formatarPercentual(fatia.percentual)})`;

            // Fatia zerada não desenha nada, mas continua na legenda (mostra "0").
            if (fatia.percentual <= 0) return null;

            return (
              <circle
                key={`${fatia.rotulo}-${indice}`}
                cx={centro}
                cy={centro}
                r={raio}
                fill="none"
                stroke={fatia.cor}
                strokeWidth={espessura}
                pathLength={100}
                strokeDasharray={`${fatia.percentual} ${100 - fatia.percentual}`}
                strokeDashoffset={-deslocamento}
              >
                <title>{detalhe}</title>
              </circle>
            );
          })}
        </g>

        <text
          x={centro}
          y={rotuloCentro ? centro - 2 : centro + 6}
          textAnchor="middle"
          fontSize={26}
          fontWeight={700}
          fill={CORES_GRAFICO.textoTitulo}
        >
          {formatarNumero(total)}
        </text>
        {rotuloCentro && (
          <text
            x={centro}
            y={centro + 18}
            textAnchor="middle"
            fontSize={11}
            fill={CORES_GRAFICO.texto}
          >
            {rotuloCentro}
          </text>
        )}
      </svg>

      {/* Legenda acessível: cor, rótulo, valor e percentual por extenso. */}
      <figcaption className="w-full">
        <ul className="space-y-1.5">
          {fatias.map((fatia, indice) => (
            <li key={`legenda-${fatia.rotulo}-${indice}`} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-sm shrink-0"
                style={{ backgroundColor: fatia.cor }}
              />
              <span className="text-gray-600 flex-1 truncate">{fatia.rotulo}</span>
              <span className="font-semibold text-gray-900">{formatarNumero(fatia.valor)}</span>
              <span className="text-gray-400 w-12 text-right">
                {formatarPercentual(fatia.percentual)}
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
