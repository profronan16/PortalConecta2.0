'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Users, Search, ChevronRight, Eye, Download,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { listMyProjetos, listInscricoes, updateInscricaoStatus, exportInscricoesCSV } from '@/actions/professor';
import { formatDateShort } from '@/lib/utils';
import { parsePerguntasExtra, resolverRespostasExtra } from '@/lib/formulario-extra';
import { Prisma } from '@prisma/client';
import { useToast } from '@/components/ui/toast';

type Projeto = Awaited<ReturnType<typeof listMyProjetos>>[number];
type Inscricao = Prisma.InscricaoGetPayload<{}>;

const STATUS_COLORS: Record<string, string> = {
  recebida: 'bg-gray-100 text-gray-700',
  em_analise: 'bg-yellow-100 text-yellow-700',
  selecionado: 'bg-green-100 text-green-700',
  lista_espera: 'bg-blue-100 text-blue-700',
  nao_selecionado: 'bg-red-100 text-red-700',
  desistente: 'bg-orange-100 text-orange-700',
};

export default function AdminInscricoesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [selectedProjeto, setSelectedProjeto] = useState<string>('');
  const [inscricoes, setInscricoes] = useState<Inscricao[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingInscricoes, setLoadingInscricoes] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [selectedInscricao, setSelectedInscricao] = useState<Inscricao | null>(null);

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
    if (!result.ok) { toast(result.error, 'error'); return; }
    const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inscricoes-${projeto?.slug ?? 'projeto'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleStatusChange = async (inscricaoId: string, newStatus: string) => {
    if (!user?.email) return;
    const result = await updateInscricaoStatus(inscricaoId, newStatus, undefined, user.email);
    if (result.ok) {
      setInscricoes((prev) =>
        prev.map((i) => (i.id === inscricaoId ? { ...i, status: newStatus } : i))
      );
      toast(`Status alterado para "${newStatus.replace(/_/g, ' ')}"`, 'success');
    } else {
      toast(result.error || 'Erro ao alterar status', 'error');
    }
  };

  const filtered = inscricoes.filter((i) => {
    const matchesSearch =
      i.nome_completo.toLowerCase().includes(search.toLowerCase()) ||
      i.email.toLowerCase().includes(search.toLowerCase()) ||
      i.protocolo.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'todos' || i.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500 text-sm">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Inscrições</h1>
          <p className="text-gray-500 text-sm">Gerencie as inscrições de todos os projetos</p>
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

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold text-gray-900">
            Inscrições ({filtered.length})
          </h2>
          <button
            onClick={handleExport}
            disabled={!selectedProjeto}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
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
            {['todos', 'recebida', 'em_analise', 'selecionado', 'nao_selecionado'].map((s) => (
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
          <div className="text-center py-12 text-gray-500 text-sm">Carregando inscrições...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
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
                      <p className="text-xs text-gray-500">{i.email}</p>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{i.curso ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{i.tipo_interesse}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{formatDateShort(i.created_at)}</td>
                    <td className="px-5 py-3">
                      <select
                        value={i.status}
                        onChange={(e) => handleStatusChange(i.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-azul-eletrico/30"
                      >
                        <option value="recebida">Recebida</option>
                        <option value="em_analise">Em análise</option>
                        <option value="selecionado">Selecionado</option>
                        <option value="lista_espera">Lista espera</option>
                        <option value="nao_selecionado">Não selecionado</option>
                        <option value="desistente">Desistente</option>
                      </select>
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
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Protocolo</p>
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
                  <p className="text-xs text-gray-500 font-medium">{field.label}</p>
                  <p className="text-sm text-gray-700">{field.value}</p>
                </div>
              ))}

              {resolverRespostasExtra(
                parsePerguntasExtra(projetos.find((p) => p.id === selectedProjeto)?.formulario_extra),
                selectedInscricao.campos_extra
              ).map((r) => (
                <div key={r.pergunta} className="pt-3 border-t border-gray-100 first:border-t-0 first:pt-0">
                  <p className="text-xs text-gray-500 font-medium">{r.pergunta}</p>
                  <p className="text-sm text-gray-700">{r.resposta}</p>
                </div>
              ))}

              <div className="pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-1">Status</p>
                <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[selectedInscricao.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {selectedInscricao.status.replace(/_/g, ' ')}
                </span>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-1">Data da inscrição</p>
                <p className="text-sm text-gray-700">{formatDateShort(selectedInscricao.created_at)}</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function X({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
