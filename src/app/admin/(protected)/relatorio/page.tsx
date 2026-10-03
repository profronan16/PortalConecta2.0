'use client';

import React, { useEffect, useState } from 'react';
import {
  Users, Download, Search, BarChart3,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { listMyProjetos, listInscricoes, exportInscricoesCSV } from '@/actions/professor';
import { getAdminRelatorioSeries } from '@/lib/relatorios';
import {
  GraficoBarras, GraficoBarrasHorizontais, GraficoRosca, PainelInscricoesProjeto,
} from '@/components/charts';
import { formatDateShort } from '@/lib/utils';
import { Prisma } from '@prisma/client';

type Projeto = Awaited<ReturnType<typeof listMyProjetos>>[number];
type Inscricao = Prisma.InscricaoGetPayload<{}>;

/** Série agregada do portal (ROADMAP 6.7) devolvida pela Server Action `getAdminRelatorioSeries`. */
type AdminSeriesResult = Awaited<ReturnType<typeof getAdminRelatorioSeries>>;
type AdminSeries = Extract<AdminSeriesResult, { ok: true }>['data'];

const STATUS_COLORS: Record<string, string> = {
  recebida: 'bg-gray-100 text-gray-700',
  em_analise: 'bg-yellow-100 text-yellow-700',
  selecionado: 'bg-green-100 text-green-700',
  lista_espera: 'bg-blue-100 text-blue-700',
  nao_selecionado: 'bg-red-100 text-red-700',
  desistente: 'bg-orange-100 text-orange-700',
};

export default function AdminRelatorioPage() {
  const { user } = useAuth();
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [selectedProjeto, setSelectedProjeto] = useState<string>('');
  const [inscricoes, setInscricoes] = useState<Inscricao[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingInscricoes, setLoadingInscricoes] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  // Agregados do portal inteiro (gráficos do item 6.7) — carregados à parte das
  // inscrições do projeto selecionado, que continuam vindo de `listInscricoes`.
  const [series, setSeries] = useState<AdminSeries | null>(null);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [loadingSeries, setLoadingSeries] = useState(true);

  useEffect(() => {
    if (!user?.email) return;
    setLoadingSeries(true);
    getAdminRelatorioSeries(user.email)
      .then((result) => {
        if (result.ok) {
          setSeries(result.data);
          setSeriesError(null);
        } else {
          setSeries(null);
          setSeriesError(result.error);
        }
      })
      .catch(() => setSeriesError('Não foi possível carregar os gráficos do portal.'))
      .finally(() => setLoadingSeries(false));
  }, [user]);

  useEffect(() => {
    if (!user?.email) return;
    listMyProjetos(user.email)
      .then((p) => {
        setProjetos(p);
        if (p.length > 0) setSelectedProjeto(p[0].id);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (!selectedProjeto || !user?.email) return;
    setLoadingInscricoes(true);
    listInscricoes(selectedProjeto, user.email)
      .then((result) => {
        if (result && 'data' in result && Array.isArray(result.data)) setInscricoes(result.data);
        else setInscricoes([]);
      })
      .catch(() => setInscricoes([]))
      .finally(() => setLoadingInscricoes(false));
  }, [selectedProjeto, user]);

  const handleExport = async () => {
    if (!selectedProjeto || !user?.email) return;
    const projeto = projetos.find((p) => p.id === selectedProjeto);
    const result = await exportInscricoesCSV(selectedProjeto, user.email);
    if (!result.ok) { alert(result.error); return; }
    const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-inscricoes-${projeto?.slug ?? 'projeto'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = inscricoes.filter((i) => {
    const matchesSearch =
      i.nome_completo.toLowerCase().includes(search.toLowerCase()) ||
      i.email.toLowerCase().includes(search.toLowerCase()) ||
      i.protocolo.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'todos' || i.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Estatísticas
  const stats = {
    total: inscricoes.length,
    recebidas: inscricoes.filter((i) => i.status === 'recebida').length,
    emAnalise: inscricoes.filter((i) => i.status === 'em_analise').length,
    selecionados: inscricoes.filter((i) => i.status === 'selecionado').length,
    naoSelecionados: inscricoes.filter((i) => i.status === 'nao_selecionado').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400 text-sm">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Relatório de Inscrições</h1>
          <p className="text-gray-500 text-sm">Visualize e exporte os dados das inscrições</p>
        </div>
      </div>

      {/* Seletor de projeto */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <label className="block text-sm font-medium text-gray-700 mb-2">Selecionar Projeto</label>
        <select
          value={selectedProjeto}
          onChange={(e) => setSelectedProjeto(e.target.value)}
          className="w-full max-w-md px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico bg-white"
        >
          {projetos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome} ({p._count?.inscricoes ?? 0} inscritos)
            </option>
          ))}
        </select>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total', value: stats.total, color: 'text-gray-900', bg: 'bg-gray-50' },
          { label: 'Recebidas', value: stats.recebidas, color: 'text-gray-600', bg: 'bg-gray-100' },
          { label: 'Em análise', value: stats.emAnalise, color: 'text-yellow-600', bg: 'bg-yellow-50' },
          { label: 'Selecionados', value: stats.selecionados, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Não selecionados', value: stats.naoSelecionados, color: 'text-red-600', bg: 'bg-red-50' },
        ].map((stat) => (
          <div key={stat.label} className={`${stat.bg} rounded-xl p-4 text-center`}>
            <p className={`text-2xl font-black ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Gráficos do projeto selecionado (ROADMAP 6.7) — mesma fonte dos cartões acima */}
      {!loadingInscricoes && inscricoes.length > 0 && (
        <PainelInscricoesProjeto inscricoes={inscricoes} />
      )}

      {/* Filtros e Export */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold text-gray-900">
            Inscrições ({filtered.length})
          </h2>
          <button
            onClick={handleExport}
            disabled={!selectedProjeto}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-azul-eletrico text-white text-sm font-semibold hover:bg-azul-eletrico/90 transition-all disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Exportar CSV
          </button>
        </div>

        {/* Filtros */}
        <div className="px-5 py-3 border-b border-gray-50 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="search"
              placeholder="Buscar por nome, email ou protocolo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-azul-eletrico"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {['todos', 'recebida', 'em_analise', 'selecionado', 'lista_espera', 'nao_selecionado', 'desistente'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  statusFilter === s
                    ? 'bg-azul-eletrico text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s === 'todos' ? 'Todos' : s.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>

        {loadingInscricoes ? (
          <div className="text-center py-12 text-gray-400 text-sm">Carregando inscrições...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Nenhuma inscrição encontrada</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                  <th className="px-5 py-3 font-medium">Protocolo</th>
                  <th className="px-5 py-3 font-medium">Inscrito</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Curso</th>
                  <th className="px-5 py-3 font-medium">Tipo</th>
                  <th className="px-5 py-3 font-medium">Data</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((i) => (
                  <tr key={i.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">{i.protocolo}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900">{i.nome_completo}</p>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{i.email}</td>
                    <td className="px-5 py-3 text-gray-600">{i.curso ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{i.tipo_interesse}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{formatDateShort(i.created_at)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[i.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {i.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Relatórios avançados com gráficos (ROADMAP 6.7) ──────────────────
          Visão geral do portal: inscrições por status/mês, projetos publicados
          por área e editais publicados por categoria. Tudo agregado no banco
          por `src/lib/relatorios.ts`. */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-black text-gray-900">Visão geral do portal</h2>
          <p className="text-gray-500 text-sm">
            Dados agregados de todo o portal (inscrições, projetos e editais publicados)
          </p>
        </div>

        {loadingSeries ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
            Carregando gráficos...
          </div>
        ) : seriesError || !series ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-gray-500">
            {seriesError ?? 'Não foi possível carregar os gráficos do portal.'}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h3 className="font-bold text-gray-900">Inscrições por status</h3>
              <p className="text-xs text-gray-500 mb-4">
                {series.totalInscricoes} inscrição(ões) em todos os projetos
              </p>
              <GraficoRosca
                dados={series.inscricoesPorStatus}
                titulo="Inscrições por status em todo o portal"
                unidade="inscrições"
                rotuloCentro="inscrições"
                textoVazio="Nenhuma inscrição registrada no portal."
              />
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h3 className="font-bold text-gray-900">Inscrições por mês</h3>
              <p className="text-xs text-gray-500 mb-4">
                Últimos 12 meses (meses sem inscrição aparecem zerados)
              </p>
              <GraficoBarras
                dados={series.inscricoesPorMes}
                titulo="Inscrições por mês em todo o portal (últimos 12 meses)"
                unidade="inscrições"
                textoVazio="Nenhuma inscrição registrada no portal."
              />
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h3 className="font-bold text-gray-900">Projetos publicados por área</h3>
              <p className="text-xs text-gray-500 mb-4">
                {series.totalProjetosPublicados} projeto(s) publicado(s)
              </p>
              <GraficoBarrasHorizontais
                dados={series.projetosPorArea}
                titulo="Projetos publicados por área"
                unidade="projetos"
                textoVazio="Nenhum projeto publicado."
              />
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h3 className="font-bold text-gray-900">Editais publicados por categoria</h3>
              <p className="text-xs text-gray-500 mb-4">
                {series.totalEditaisPublicados} edital(is) publicado(s)
              </p>
              <GraficoRosca
                dados={series.editaisPorCategoria}
                titulo="Editais publicados por categoria"
                unidade="editais"
                rotuloCentro="editais"
                textoVazio="Nenhum edital publicado."
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
