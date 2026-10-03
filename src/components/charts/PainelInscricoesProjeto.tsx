'use client';

import { useMemo } from 'react';
import {
  contagensParaMapa,
  mesChave,
  montarSerieStatus,
  preencherSerieMensal,
  type ContagemMensal,
} from '@/lib/relatorios-series';
import GraficoBarras from './GraficoBarras';
import GraficoRosca from './GraficoRosca';

/**
 * Bloco de gráficos do projeto SELECIONADO nas páginas de relatório
 * (ROADMAP 6.7).
 *
 * As duas páginas (admin e professor) mostram os mesmos dois gráficos sobre as
 * inscrições que já carregaram em memória — este componente existe para os
 * números do gráfico saírem exatamente do mesmo array que alimenta as tabelas e
 * os cartões de estatística, sem uma segunda consulta que poderia divergir.
 *
 * O tipo de entrada é mínimo (`status` + `created_at`) para aceitar a linha do
 * Prisma sem cast.
 */

export type LinhaInscricaoGrafico = {
  status: string;
  created_at: Date | string;
};

type Props = {
  inscricoes: readonly LinhaInscricaoGrafico[];
  /** Quantos meses mostrar no gráfico mensal. */
  meses?: number;
  className?: string;
};

export default function PainelInscricoesProjeto({
  inscricoes,
  meses = 6,
  className,
}: Props) {
  const linhas = inscricoes ?? [];

  const serieStatus = useMemo(() => {
    const contagens = linhas.reduce<Record<string, number>>((acc, inscricao) => {
      const status = inscricao?.status ?? 'nao_informado';
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    }, {});
    return montarSerieStatus(contagens);
  }, [linhas]);

  const serieMensal = useMemo(() => {
    const contagens: ContagemMensal[] = linhas.map((inscricao) => ({
      periodo: mesChave(inscricao?.created_at ?? ''),
      total: 1,
    }));
    return preencherSerieMensal(contagens, { quantidade: meses });
  }, [linhas, meses]);

  return (
    <div className={`grid gap-4 lg:grid-cols-2 ${className ?? ''}`}>
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h3 className="font-bold text-gray-900">Inscrições por status</h3>
        <p className="text-xs text-gray-500 mb-4">
          Distribuição das {linhas.length} inscrição(ões) do projeto selecionado
        </p>
        <GraficoRosca
          dados={serieStatus}
          titulo="Inscrições por status no projeto selecionado"
          unidade="inscrições"
          rotuloCentro="inscrições"
          textoVazio="Nenhuma inscrição neste projeto ainda."
        />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h3 className="font-bold text-gray-900">Inscrições por mês</h3>
        <p className="text-xs text-gray-500 mb-4">
          Últimos {meses} meses (meses sem inscrição aparecem zerados)
        </p>
        <GraficoBarras
          dados={serieMensal}
          titulo={`Inscrições por mês no projeto selecionado (últimos ${meses} meses)`}
          unidade="inscrições"
          altura={200}
          textoVazio="Nenhuma inscrição neste projeto ainda."
        />
      </div>
    </div>
  );
}
