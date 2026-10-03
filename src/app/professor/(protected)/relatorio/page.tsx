'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Users, Download, Search, ChevronRight, FileSpreadsheet,
  Filter, Eye, CheckCircle, Clock, XCircle, AlertCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { listMyProjetos, listInscricoes, exportInscricoesCSV } from '@/actions/professor';
import { getProfessorRelatorioSeries } from '@/lib/relatorios';
import {
  GraficoBarras, GraficoBarrasHorizontais, GraficoRosca, PainelInscricoesProjeto,
} from '@/components/charts';
import { formatDateShort, getStatusLabel } from '@/lib/utils';
import { Prisma } from '@prisma/client';

type Projeto = Awaited<ReturnType<typeof listMyProjetos>>[number];
type Inscricao = Prisma.InscricaoGetPayload<{}>;

/** Série agregada dos projetos do professor (ROADMAP 6.7). */
type ProfessorSeriesResult = Awaited<ReturnType<typeof getProfessorRelatorioSeries>>;
type ProfessorSeries = Extract<ProfessorSeriesResult, { ok: true }>['data'];

const STATUS_COLORS: Record<string, string> = {
  recebida: 'bg-gray-100 text-gray-700',
  em_analise: 'bg-yellow-100 text-yellow-700',
  selecionado: 'bg-green-100 text-green-700',
  lista_espera: 'bg-blue-100 text-blue-700',
  nao_selecionado: 'bg-red-100 text-red-700',
  desistente: 'bg-orange-100 text-orange-700',
};

export default function ProfessorRelatorioPage() {
  const { user } = useAuth();
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [selectedProjeto, setSelectedProjeto] = useState<string>('');
  const [inscricoes, setInscricoes] = useState<Inscricao[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingInscricoes, setLoadingInscricoes] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [selectedInscricao, setSelectedInscricao] = useState<Inscricao | null>(null);
  // Agregados dos projetos do professor (gráficos do item 6.7). O escopo é
  // sempre restrito pelo e-mail na Server Action — a tela só escolhe entre
  // "todos os meus projetos" e o projeto selecionado no topo.
  const [escopoGraficos, setEscopoGraficos] = useState<'todos' | 'projeto'>('todos');
  const [series, setSeries] = useState<ProfessorSeries | null>(null);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [loadingSeries, setLoadingSeries] = useState(true);

  const projetoDoEscopo = escopoGraficos === 'projeto' ? selectedProjeto || undefined : undefined;

  useEffect(() => {
    if (!user?.email) return;
    setLoadingSeries(true);
    getProfessorRelatorioSeries(user.email, projetoDoEscopo)
      .then((result) => {
        if (result.ok) {
          setSeries(result.data);
          setSeriesError(null);
        } else {
          setSeries(null);
          setSeriesError(result.error);
        }
      })
      .catch(() => setSeriesError('Não foi possível carregar os gráficos dos seus projetos.'))
      .finally(() => setLoadingSeries(false));
  }, [user, projetoDoEscopo]);

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

  // Gráfico de vagas preenchidas (ROADMAP 6.7). A escala usa a MAIOR oferta de
  // vagas como denominador para que "4 de 4" apareça cheio e "1 de 10" apareça
  // curto, mesmo com números absolutos bem diferentes entre projetos.
  const vagasDoEscopo = series?.vagasPorProjeto ?? [];
  const dadosVagas = vagasDoEscopo.map((vaga) => ({
    rotulo: vaga.rotulo,
    valor: vaga.preenchidas,
    percentual: vaga.percentual,
  }));
  const maiorOfertaDeVagas = Math.max(1, ...vagasDoEscopo.map((vaga) => vaga.total));
  const vagasPorRotulo = new Map(vagasDoEscopo.map((vaga) => [vaga.rotulo, vaga]));

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
            <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
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
                  <th className="px-5 py-3 font-medium">Ações</th>
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
                    <td className="px-5 py-3">
                      <button
                        onClick={() => setSelectedInscricao(i)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                        title="Ver detalhes"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de detalhes */}
      {selectedInscricao && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setSelectedInscricao(null)} />
          <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-white z-50 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">Detalhes da Inscrição</h2>
              <button onClick={() => setSelectedInscricao(null)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <XCircle className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">Protocolo</p>
                <p className="text-lg font-black text-azul-eletrico font-mono">{selectedInscricao.protocolo}</p>
              </div>

              {[
                { label: 'Nome', value: selectedInscricao.nome_completo },
                { label: 'Email', value: selectedInscricao.email },
                { label: 'Telefone', value: selectedInscricao.telefone },
                { label: 'Curso', value: selectedInscricao.curso },
                { label: 'Turma', value: selectedInscricao.turma },
                { label: 'Semestre', value: selectedInscricao.semestre },
                { label: 'Matrícula', value: selectedInscricao.matricula },
                { label: 'Idade', value: selectedInscricao.idade?.toString() },
                { label: 'Tipo interesse', value: selectedInscricao.tipo_interesse },
                { label: 'Disponibilidade', value: selectedInscricao.disponibilidade },
                { label: 'Experiência', value: selectedInscricao.experiencia_previa },
                { label: 'Justificativa', value: selectedInscricao.justificativa },
              ].filter((f) => f.value).map((field) => (
                <div key={field.label}>
                  <p className="text-xs text-gray-400 font-medium">{field.label}</p>
                  <p className="text-sm text-gray-700">{field.value}</p>
                </div>
              ))}

              <div className="pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Status</p>
                <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[selectedInscricao.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {selectedInscricao.status.replace(/_/g, ' ')}
                </span>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Data da inscrição</p>
                <p className="text-sm text-gray-700">{formatDateShort(selectedInscricao.created_at)}</p>
              </div>

              {selectedInscricao.observacao_interna && (
                <div className="pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-400 mb-1">Observação interna</p>
                  <p className="text-sm text-gray-700">{selectedInscricao.observacao_interna}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Relatórios avançados com gráficos (ROADMAP 6.7) ──────────────────
          Sempre restritos aos projetos deste professor: o filtro de acesso é
          aplicado no servidor por `getProfessorRelatorioSeries`. */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-gray-900">Gráficos dos meus projetos</h2>
            <p className="text-gray-500 text-sm">
              Inscrições e vagas{' '}
              {escopoGraficos === 'projeto' ? 'do projeto selecionado' : 'de todos os seus projetos'}
            </p>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {([
              { valor: 'todos', rotulo: 'Todos os meus projetos' },
              { valor: 'projeto', rotulo: 'Projeto selecionado' },
            ] as const).map((opcao) => (
              <button
                key={opcao.valor}
                type="button"
                onClick={() => setEscopoGraficos(opcao.valor)}
                disabled={opcao.valor === 'projeto' && !selectedProjeto}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all disabled:opacity-40 ${
                  escopoGraficos === opcao.valor
                    ? 'bg-azul-eletrico text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opcao.rotulo}
              </button>
            ))}
          </div>
        </div>

        {loadingSeries ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
            Carregando gráficos...
          </div>
        ) : seriesError || !series ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-gray-500">
            {seriesError ?? 'Não foi possível carregar os gráficos dos seus projetos.'}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h3 className="font-bold text-gray-900">Inscrições por status</h3>
              <p className="text-xs text-gray-500 mb-4">
                {series.totalInscricoes} inscrição(ões) em {series.totalProjetos} projeto(s)
              </p>
              <GraficoRosca
                dados={series.inscricoesPorStatus}
                titulo="Inscrições por status nos seus projetos"
                unidade="inscrições"
                rotuloCentro="inscrições"
                textoVazio="Nenhuma inscrição nos seus projetos."
              />
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h3 className="font-bold text-gray-900">Inscrições por mês</h3>
              <p className="text-xs text-gray-500 mb-4">
                Últimos 12 meses (meses sem inscrição aparecem zerados)
              </p>
              <GraficoBarras
                dados={series.inscricoesPorMes}
                titulo="Inscrições por mês nos seus projetos (últimos 12 meses)"
                unidade="inscrições"
                textoVazio="Nenhuma inscrição nos seus projetos."
              />
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 lg:col-span-2">
              <h3 className="font-bold text-gray-900">Vagas preenchidas por projeto</h3>
              <p className="text-xs text-gray-500 mb-4">
                Selecionados sobre o total de vagas ofertadas — {' '}
                {series.totalSelecionados} de {series.totalVagas} vaga(s)
              </p>
              <GraficoBarrasHorizontais
                dados={dadosVagas}
                titulo="Vagas preenchidas por projeto"
                unidade="selecionados"
                maximo={maiorOfertaDeVagas}
                formatarValor={(dado) => {
                  const vaga = vagasPorRotulo.get(dado.rotulo);
                  return vaga ? `${vaga.preenchidas}/${vaga.total}` : `${dado.valor}`;
                }}
                textoVazio="Nenhum projeto seu tem vagas ofertadas."
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
