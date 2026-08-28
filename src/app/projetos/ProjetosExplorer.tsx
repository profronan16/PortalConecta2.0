'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Filter, Users, ArrowRight, Sparkles, FolderOpen } from 'lucide-react';
import { getStatusLabel } from '@/lib/utils';
import { stripHtml } from '@/lib/rich-text';

type Projeto = {
  id: string;
  nome: string;
  slug: string;
  area: string;
  coordenador: string;
  status: string;
  corPrimaria: string;
  descricao: string | null;
  destaque: boolean;
};

export function ProjetosExplorer({ projetos }: { projetos: Projeto[] }) {
  const [busca, setBusca] = useState('');
  const [area, setArea] = useState('Todas');
  const [status, setStatus] = useState('Todos');

  // Opções derivadas dos projetos que realmente existem, não de uma lista
  // fixa de todos os valores possíveis do enum — senão o filtro oferece
  // status como "Ativo" mesmo quando nenhum projeto está nesse status hoje.
  const areas = useMemo(
    () => ['Todas', ...Array.from(new Set(projetos.map((p) => p.area).filter(Boolean))).sort()],
    [projetos]
  );
  const statusOptions = useMemo(
    () => ['Todos', ...Array.from(new Set(projetos.map((p) => p.status)))],
    [projetos]
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return projetos.filter((p) => {
      const matchBusca =
        !termo ||
        p.nome.toLowerCase().includes(termo) ||
        p.coordenador.toLowerCase().includes(termo);
      const matchArea = area === 'Todas' || p.area === area;
      const matchStatus = status === 'Todos' || p.status === status;
      return matchBusca && matchArea && matchStatus;
    });
  }, [projetos, busca, area, status]);

  const hasFilter = busca.trim() !== '' || area !== 'Todas' || status !== 'Todos';
  const destaques = projetos.filter((p) => p.destaque);

  return (
    <>
      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            placeholder="Buscar por nome ou coordenador..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico focus:border-transparent"
          />
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="pl-3 pr-8 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico bg-white"
            >
              <option value="Todas">Área: Todas</option>
              {areas.slice(1).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="pl-3 pr-8 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico bg-white"
          >
            <option value="Todos">Status: Todos</option>
            {statusOptions.slice(1).map((s) => <option key={s} value={s}>{getStatusLabel(s)}</option>)}
          </select>
        </div>
      </div>

      {/* Projetos Destaque — só faz sentido sem filtro ativo (senão duplica
          resultados que já aparecem, às vezes fora do filtro, na seção
          "Todos") */}
      {!hasFilter && destaques.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-5">
            <Sparkles className="w-5 h-5 text-dourado-ifizinha" />
            <h2 className="font-bold text-gray-900 text-lg">Projetos em Destaque</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {destaques.map((projeto) => (
              <Link key={projeto.id} href={`/projetos/${projeto.slug}`} className="group block">
                <div className="bg-white rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden h-full flex flex-col">
                  <div className="h-24 relative flex items-end p-4" style={{ background: `linear-gradient(135deg, ${projeto.corPrimaria} 0%, ${projeto.corPrimaria}cc 100%)` }}>
                    <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center text-white font-black text-2xl border border-white/30">
                      {projeto.nome.charAt(0)}
                    </div>
                    <div className="ml-auto">
                      <span className="text-white/80 text-xs bg-black/20 rounded-full px-2.5 py-1 font-medium">
                        {getStatusLabel(projeto.status)}
                      </span>
                    </div>
                  </div>
                  <div className="p-5 flex-1 flex flex-col">
                    <h3 className="font-bold text-gray-900 text-base leading-snug mb-1 group-hover:text-azul-eletrico transition-colors">
                      {projeto.nome}
                    </h3>
                    <p className="text-sm text-gray-500 mb-2 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" />
                      {projeto.coordenador}
                    </p>
                    <p className="text-sm text-gray-500 leading-relaxed flex-1 line-clamp-2">{stripHtml(projeto.descricao)}</p>
                    <div className="mt-4 flex items-center justify-between">
                      <span
                        className="inline-flex px-3 py-1 rounded-full text-xs font-semibold text-white"
                        style={{ backgroundColor: projeto.corPrimaria }}
                      >
                        {projeto.area}
                      </span>
                      <div className="flex items-center gap-1 text-xs font-semibold text-azul-eletrico group-hover:gap-2 transition-all">
                        Saiba mais
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Todos os projetos / resultados da busca */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-gray-900 text-lg">
            {hasFilter ? `Resultados (${filtrados.length})` : `Todos os Projetos (${projetos.length})`}
          </h2>
        </div>

        {filtrados.length === 0 ? (
          <div className="text-center py-16 text-gray-500 bg-white rounded-2xl border border-gray-100">
            <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Nenhum projeto encontrado com esses filtros</p>
            <button
              onClick={() => { setBusca(''); setArea('Todas'); setStatus('Todos'); }}
              className="mt-3 text-sm text-azul-eletrico hover:underline"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtrados.map((projeto) => (
              <Link key={projeto.id} href={`/projetos/${projeto.slug}`} className="group block">
                <div className="bg-white rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
                  <div className="h-2 w-full" style={{ backgroundColor: projeto.corPrimaria }} />
                  <div className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-base flex-shrink-0 shadow-sm"
                        style={{ backgroundColor: projeto.corPrimaria }}
                      >
                        {projeto.nome.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 text-sm leading-snug group-hover:text-azul-eletrico transition-colors line-clamp-2">
                          {projeto.nome}
                        </h3>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{projeto.coordenador}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span
                        className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: projeto.corPrimaria }}
                      >
                        {projeto.area}
                      </span>
                      <span className={`text-xs font-medium flex items-center gap-1 ${
                        projeto.status === 'EM_EXECUCAO' ? 'text-green-600' :
                        projeto.status === 'ATIVO' ? 'text-blue-600' :
                        'text-gray-500'
                      }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          projeto.status === 'EM_EXECUCAO' ? 'bg-green-500 animate-pulse' :
                          projeto.status === 'ATIVO' ? 'bg-blue-500' :
                          'bg-gray-400'
                        }`} />
                        {getStatusLabel(projeto.status)}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
