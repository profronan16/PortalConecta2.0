import React from 'react';
import Link from 'next/link';
import { FolderOpen, ChevronRight, TrendingUp, Sparkles, ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import { listProjetosPublicos } from '@/lib/projetos-publicos';
import {
  normalizarParamsProjetos,
  type ProjetoSearchParams,
} from '@/lib/projetos-filtros';
import { ProjetosExplorer } from './ProjetosExplorer';

export const metadata: Metadata = {
  title: 'Projetos',
  description: 'Diretório completo dos projetos de extensão, pesquisa e ensino do IFPR Campus Ivaiporã.',
};

// Filtro e paginação acontecem no servidor (ROADMAP 1.15b): a página lê os
// searchParams e busca apenas a página atual no banco.
export default async function ProjetosPage({
  searchParams,
}: {
  searchParams: ProjetoSearchParams;
}) {
  const params = normalizarParamsProjetos(searchParams);
  const resultado = await listProjetosPublicos(params);
  const { stats } = resultado;

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <div className="bg-hero-gradient pt-24 pb-16">
        <div className="container mx-auto px-4 max-w-7xl">
          <div className="flex items-center gap-2 text-white/70 text-sm mb-4">
            <Link href="/" className="hover:text-white transition-colors">Início</Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-white">Projetos</span>
          </div>
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 bg-white/15 rounded-2xl flex items-center justify-center border border-white/30 flex-shrink-0">
              <FolderOpen className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-black text-white mb-2">Projetos de Extensão</h1>
              <p className="text-white/80 text-lg max-w-2xl">
                Conheça os projetos que estão transformando o Vale do Ivaí.
                Pesquisa, extensão e ensino conectando o IFPR à comunidade.
              </p>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-8 flex flex-wrap gap-4">
            {[
              { label: 'Em Execução', value: stats.emExecucao, color: 'bg-green-500' },
              { label: 'Inscrições Abertas', value: stats.inscricoesAbertas, color: 'bg-blue-500' },
              { label: 'Total', value: stats.total, color: 'bg-white/30' },
            ].map((s) => (
              <div key={s.label} className="bg-white/15 backdrop-blur-sm rounded-xl px-5 py-3 border border-white/20 flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${s.color}`} />
                <span className="text-white font-bold text-lg">{s.value}</span>
                <span className="text-white/70 text-sm">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="container mx-auto px-4 max-w-7xl py-10">
        <ProjetosExplorer
          projetos={resultado.itens}
          destaques={resultado.destaques}
          total={resultado.total}
          page={resultado.page}
          totalPages={resultado.totalPages}
          filtros={resultado.filtros}
          filtrando={resultado.filtrando}
          params={params}
        />

        {/* CTA Participe */}
        <div className="mt-12 bg-gradient-to-br from-azul-eletrico/5 via-roxo-luminoso/5 to-rosa-vibrante/5 rounded-3xl border border-gray-100 p-8 md:p-10 text-center">
          <div className="w-14 h-14 bg-hero-gradient rounded-2xl flex items-center justify-center mx-auto mb-4">
            <TrendingUp className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-2xl font-black text-gray-900 mb-3">Quer fazer parte de um projeto?</h2>
          <p className="text-gray-500 max-w-md mx-auto mb-6">
            Entre em contato com o coordenador do projeto ou aguarde os editais de bolsas de extensão!
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/editais" className="inline-flex items-center justify-center gap-2 bg-hero-gradient text-white font-semibold px-6 py-3 rounded-xl hover:opacity-90 transition-all">
              <Sparkles className="w-5 h-5" />
              Ver Editais de Bolsas
            </Link>
            <Link href="/agenda" className="inline-flex items-center justify-center gap-2 border border-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl hover:bg-gray-50 transition-all">
              Ver Eventos
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
