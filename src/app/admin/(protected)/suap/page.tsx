'use client';

import React, { useState, useEffect, useCallback, useTransition } from 'react';
import {
  RefreshCw, CheckCircle2, AlertCircle, AlertTriangle, Clock, FolderOpen,
  FileText, Zap, Database, Settings, ExternalLink, ChevronDown,
  ChevronUp, Play, Search, Wifi, WifiOff,
} from 'lucide-react';
import {
  syncProjetosAction,
  syncEditaisAction,
  getSuapStatusAction,
} from '@/actions/suap';
import { useAuth } from '@/contexts/AuthContext';

// ─── Tipos ─────────────────────────────────────────────────────────────────────

interface SyncResult {
  ok: boolean;
  total: number;
  criados: number;
  atualizados: number;
  /** Registros editados manualmente no portal que o sync NÃO sobrescreveu. */
  preservados?: number;
  erros: number;
  detalhes: string[];
  dadosBrutos?: unknown;
  duracao?: string;
  error?: string;
}

interface StatusData {
  suap: {
    configurado: boolean;
    temApiToken?: boolean;
    temUserPass?: boolean;
    baseUrl: string;
    campus: string;
    conexao: { ok: boolean; message: string; endpoints?: string[] };
  };
  banco: {
    totalProjetos: number;
    totalEditais: number;
    projetosDoSuap: number;
    editaisDoSuap: number;
  };
  logs: Array<{
    id: string;
    tipo: string;
    status: string;
    totalSuap: number;
    sincronizados: number;
    erros: number;
    mensagem?: string;
    createdAt: string;
  }>;
}

type SyncType = 'projetos' | 'editais';

// ─── Componente Principal ──────────────────────────────────────────────────────

export default function SuapSyncPage() {
  const { user, isMasterAdmin } = useAuth();
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [syncing, setSyncing] = useState<SyncType | null>(null);
  const [lastResult, setLastResult] = useState<{ type: SyncType; result: SyncResult } | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [isPending, startTransition] = useTransition();

  if (!isMasterAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-gray-500">Acesso restrito ao Administrador Master.</p>
      </div>
    );
  }

  const fetchStatus = useCallback(async () => {
    if (!user?.email) return;
    try {
      setLoadingStatus(true);
      const raw = await getSuapStatusAction(user.email);
      // Serializa datas (Date → string) para compatibilidade com o tipo StatusData
      const data: StatusData = {
        ...raw,
        logs: raw.logs.map((l) => ({
          ...l,
          mensagem: l.mensagem ?? undefined,
          createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : String(l.createdAt),
        })),
      };
      setStatusData(data);
    } catch {
      // silencioso
    } finally {
      setLoadingStatus(false);
    }
  }, [user]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleSync = async (type: SyncType, forcar = false) => {
    if (!user?.email) return;
    setSyncing(type);
    setLastResult(null);
    try {
      const action = type === 'projetos' ? syncProjetosAction : syncEditaisAction;
      const result = await action(false, user.email, forcar);
      setLastResult({ type, result: { ...result, ok: result.erros === 0 } as SyncResult });
      await fetchStatus();
    } finally {
      setSyncing(null);
    }
  };

  /** Sync forçada: sobrescreve também registros editados manualmente no portal. */
  const handleSyncForcada = async (type: SyncType) => {
    const confirmado = window.confirm(
      'Sync forçada: os registros editados manualmente no portal serão SOBRESCRITOS com os dados do SUAP. Continuar?',
    );
    if (!confirmado) return;
    await handleSync(type, true);
  };

  const handleDryRun = async (type: SyncType) => {
    if (!user?.email) return;
    setSyncing(type);
    setLastResult(null);
    try {
      const action = type === 'projetos' ? syncProjetosAction : syncEditaisAction;
      const result = await action(true, user.email);
      setLastResult({ type, result: { ...result, ok: result.erros === 0 } as SyncResult });
    } finally {
      setSyncing(null);
    }
  };

  const handleTestConn = async () => {
    setTestingConn(true);
    await fetchStatus();
    setTestingConn(false);
  };

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) {
      setTokenMessage({ type: 'error', text: 'Cole o token no campo abaixo' });
      return;
    }

    if (!tokenInput.startsWith('eyJ')) {
      setTokenMessage({ type: 'error', text: 'Token inválido. Deve começar com "eyJ"' });
      return;
    }

    if (!user?.email) return;

    setSavingToken(true);
    try {
      const response = await fetch('/api/admin/suap/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim(), adminEmail: user.email }),
      });

      const result = await response.json();

      if (result.ok) {
        setTokenMessage({ type: 'success', text: 'Token salvo! Clique em "Testar" para verificar a conexão.' });
        setTokenInput('');
        await fetchStatus();
      } else {
        setTokenMessage({ type: 'error', text: result.error || 'Erro ao salvar token' });
      }
    } catch {
      setTokenMessage({ type: 'error', text: 'Erro ao salvar token' });
    } finally {
      setSavingToken(false);
    }
  };

  const suap = statusData?.suap;
  const banco = statusData?.banco;
  const logs = statusData?.logs ?? [];
  const configurado = suap?.configurado ?? false;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Sincronização SUAP</h1>
          <p className="text-gray-500 text-sm mt-1">
            Importe projetos e editais do SUAP IFPR automaticamente para o portal.
          </p>
        </div>
        <button
          onClick={fetchStatus}
          disabled={loadingStatus}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loadingStatus ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Status SUAP */}
      <div className={`rounded-2xl border p-5 ${
        configurado && suap?.conexao?.ok
          ? 'bg-green-50 border-green-200'
          : configurado
          ? 'bg-orange-50 border-orange-200'
          : 'bg-red-50 border-red-200'
      }`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {configurado && suap?.conexao?.ok ? (
              <Wifi className="w-5 h-5 text-green-600 flex-shrink-0" />
            ) : (
              <WifiOff className="w-5 h-5 text-red-500 flex-shrink-0" />
            )}
            <div>
              <p className="font-semibold text-gray-900 text-sm">
                {configurado
                  ? suap?.conexao?.ok
                    ? '✅ Conectado ao SUAP'
                    : '⚠️ Credenciais configuradas, mas conexão falhou'
                  : '❌ SUAP não configurado'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {suap?.baseUrl ?? 'https://suap.ifpr.edu.br'} · Campus: {suap?.campus ?? 'Ivaiporã'}
              </p>
              {suap?.conexao?.message && !suap.conexao.ok && (
                <p className="text-xs text-red-600 mt-1 font-mono line-clamp-3">{suap.conexao.message}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleTestConn}
            disabled={testingConn}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors flex-shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testingConn ? 'animate-spin' : ''}`} />
            Testar
          </button>
        </div>

        {/* Endpoints disponíveis */}
        {suap?.conexao?.endpoints && suap.conexao.endpoints.length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-800 w-fit">
              {suap.conexao.endpoints.length} endpoints disponíveis
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suap.conexao.endpoints.map((ep) => (
                <span key={ep} className="bg-white/70 text-gray-700 text-xs px-2 py-0.5 rounded-md border border-gray-200 font-mono">
                  {ep}
                </span>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Guia quando conexão falha */}
      {configurado && !suap?.conexao?.ok && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
          <p className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Autenticação SUAP
          </p>

          <p className="text-sm text-blue-800 mb-4">
            O SUAP bloqueia login via API de IPs externos. Você precisa obter um <strong>token pessoal</strong> válido por 24h.
          </p>

          {/* Campo para colar o token */}
          <div className="bg-white rounded-xl p-4 mb-4 border border-blue-200">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              1. Cole seu token aqui:
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                autoComplete="off"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                className="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-azul-eletrico"
              />
              <button
                onClick={handleSaveToken}
                disabled={savingToken || !tokenInput.trim()}
                className="px-4 py-2 bg-azul-eletrico text-white rounded-lg text-sm font-medium hover:bg-azul-eletrico/90 transition-colors disabled:opacity-50"
              >
                {savingToken ? 'Salvando...' : 'Salvar Token'}
              </button>
            </div>
            {tokenMessage && (
              <p className={`text-xs mt-2 ${tokenMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {tokenMessage.text}
              </p>
            )}
          </div>

          {/* Instruções para obter o token */}
          <div className="bg-blue-100/50 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-900 mb-2">2. Como obter o token (2 minutos):</p>
            <ol className="text-sm text-blue-800 space-y-2 list-decimal list-inside">
              <li>
                Abra{' '}
                <a href="https://suap.ifpr.edu.br/api/docs/" target="_blank" rel="noopener noreferrer"
                  className="underline font-medium hover:text-blue-900">
                  suap.ifpr.edu.br/api/docs/
                </a>
                {' '}em outra aba (precisa estar logado no SUAP)
              </li>
              <li>Clique no botão verde <strong>&quot;Authorize&quot;</strong> no topo da página</li>
              <li>Na seção <strong>tokenAuth</strong>, clique <strong>&quot;Try it out&quot;</strong></li>
              <li>Preencha:
                <ul className="ml-6 mt-1 space-y-1 list-disc text-xs">
                  <li><strong>username:</strong> <code className="bg-blue-100 px-1 rounded">20251IVA10030013</code></li>
                  <li><strong>password:</strong> <code className="bg-blue-100 px-1 rounded">sua senha do SUAP</code></li>
                </ul>
              </li>
              <li>Clique <strong>&quot;Execute&quot;</strong></li>
              <li>Copie o valor do campo <strong>&quot;access&quot;</strong> (começa com <code className="bg-blue-100 px-1 rounded">eyJ...</code>)</li>
              <li>Cole no campo acima e clique <strong>&quot;Salvar Token&quot;</strong></li>
            </ol>
          </div>

          <p className="text-xs text-blue-700 mt-3">
            ⚡ Token válido por 24h. Quando expirar, repita o processo acima.
          </p>
        </div>
      )}

      {!configurado && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
          <p className="font-semibold text-orange-800 mb-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Configure o SUAP
          </p>

          {/* Campo para colar o token */}
          <div className="bg-white rounded-xl p-4 mb-4 border border-orange-200">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Cole seu token SUAP:
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                autoComplete="off"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                className="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-azul-eletrico"
              />
              <button
                onClick={handleSaveToken}
                disabled={savingToken || !tokenInput.trim()}
                className="px-4 py-2 bg-azul-eletrico text-white rounded-lg text-sm font-medium hover:bg-azul-eletrico/90 transition-colors disabled:opacity-50"
              >
                {savingToken ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
            {tokenMessage && (
              <p className={`text-xs mt-2 ${tokenMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {tokenMessage.text}
              </p>
            )}
          </div>

          <ol className="text-sm text-orange-700 space-y-2 list-decimal list-inside">
            <li>
              Acesse{' '}
              <a href="https://suap.ifpr.edu.br/api/docs/" target="_blank" rel="noopener noreferrer"
                className="underline font-medium">
                suap.ifpr.edu.br/api/docs/
              </a>
              (precisa estar logado)
            </li>
            <li>Clique <strong>&quot;Authorize&quot;</strong> → <code className="bg-orange-100 px-1 rounded">POST /api/token/pair</code></li>
            <li>Use seu login SUAP → copie o campo <strong>&quot;access&quot;</strong></li>
            <li>Cole no campo acima e clique &quot;Salvar&quot;</li>
          </ol>
        </div>
      )}

      {/* Stats do banco */}
      {banco && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Projetos totais', value: banco.totalProjetos, sub: `${banco.projetosDoSuap} do SUAP`, icon: FolderOpen, color: 'text-azul-eletrico' },
            { label: 'Editais totais', value: banco.totalEditais, sub: `${banco.editaisDoSuap} do SUAP`, icon: FileText, color: 'text-roxo-luminoso' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4">
              <s.icon className={`w-5 h-5 ${s.color} mb-2`} />
              <p className="text-2xl font-black text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-xs text-gray-400">{s.sub}</p>
            </div>
          ))}
          {/* Última sync */}
          {logs.slice(0, 2).map((log) => (
            <div key={log.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <Clock className="w-5 h-5 text-ciano-claro mb-2" />
              <p className="text-sm font-bold text-gray-900 capitalize">{log.tipo}</p>
              <p className="text-xs text-gray-500">{new Date(log.createdAt).toLocaleString('pt-BR')}</p>
              <p className={`text-xs font-medium mt-0.5 ${log.status === 'success' ? 'text-green-600' : log.status === 'error' ? 'text-red-600' : 'text-orange-600'}`}>
                {log.status} · {log.sincronizados} registros
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ─── Botões de Sync ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Sync Projetos */}
        <SyncCard
          title="Projetos de Extensão"
          description="Importa todos os projetos do SUAP para o portal. Preserva personalizações manuais."
          icon={FolderOpen}
          color="azul"
          disabled={!configurado}
          loading={syncing === 'projetos'}
          onSync={() => handleSync('projetos')}
          onDryRun={() => handleDryRun('projetos')}
          onForce={() => handleSyncForcada('projetos')}
          lastLog={logs.find((l) => l.tipo === 'projetos')}
        />

        {/* Sync Editais */}
        <SyncCard
          title="Editais & Oportunidades"
          description="Importa editais do SUAP. A tradução IFizinha pode ser editada manualmente depois."
          icon={FileText}
          color="roxo"
          disabled={!configurado}
          loading={syncing === 'editais'}
          onSync={() => handleSync('editais')}
          onDryRun={() => handleDryRun('editais')}
          onForce={() => handleSyncForcada('editais')}
          lastLog={logs.find((l) => l.tipo === 'editais')}
        />
      </div>

      {/* ─── Resultado da última sync ─── */}
      {lastResult && (
        <div className={`rounded-2xl border p-5 ${
          lastResult.result.ok
            ? lastResult.result.erros > 0 ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'
            : 'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {lastResult.result.ok && lastResult.result.erros === 0
                ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                : <AlertCircle className="w-5 h-5 text-orange-600" />}
              <h3 className="font-bold text-gray-900 capitalize">
                Resultado: sync {lastResult.type}
              </h3>
            </div>
            {lastResult.result.duracao && (
              <span className="text-xs text-gray-500">{lastResult.result.duracao}</span>
            )}
          </div>

          {lastResult.result.error && (
            <p className="text-red-700 text-sm mb-3 font-mono bg-red-50 rounded-lg p-3">
              {lastResult.result.error}
            </p>
          )}

          <div className="flex gap-4 text-sm mb-3">
            <span className="text-gray-600">Total SUAP: <strong>{lastResult.result.total}</strong></span>
            <span className="text-green-700">Criados: <strong>{lastResult.result.criados}</strong></span>
            <span className="text-blue-700">Atualizados: <strong>{lastResult.result.atualizados}</strong></span>
            {!!lastResult.result.preservados && (
              <span
                className="text-amber-700"
                title="Editados manualmente no portal depois do último sync — não foram sobrescritos"
              >
                Preservados (edição manual): <strong>{lastResult.result.preservados}</strong>
              </span>
            )}
            {lastResult.result.erros > 0 && (
              <span className="text-red-700">Erros: <strong>{lastResult.result.erros}</strong></span>
            )}
          </div>

          {lastResult.result.detalhes.length > 0 && (
            <details open>
              <summary className="text-xs text-gray-600 cursor-pointer font-medium mb-2">
                Ver detalhes ({lastResult.result.detalhes.length} linhas)
              </summary>
              <pre className="text-xs text-gray-700 bg-white/70 rounded-xl p-3 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                {lastResult.result.detalhes.join('\n')}
              </pre>
            </details>
          )}

          {/* Dados brutos da API */}
          {!!lastResult.result.dadosBrutos && (
            <div className="mt-3">
              <button
                onClick={() => setShowRaw(!showRaw)}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
              >
                {showRaw ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {showRaw ? 'Ocultar' : 'Ver'} amostra JSON do SUAP (3 registros)
              </button>
              {showRaw && (
                <pre className="mt-2 text-xs bg-gray-900 text-green-400 rounded-xl p-4 max-h-64 overflow-auto font-mono">
                  {JSON.stringify(lastResult.result.dadosBrutos, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── Histórico de logs ─── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-4 h-4 text-azul-eletrico" />
          <h2 className="font-bold text-gray-900">Histórico de Sincronizações</h2>
        </div>

        {logs.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <RefreshCw className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhuma sincronização realizada ainda.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div key={log.id} className={`rounded-xl border p-3.5 ${
                log.status === 'success' ? 'bg-green-50 border-green-100' :
                log.status === 'error' ? 'bg-red-50 border-red-100' :
                'bg-orange-50 border-orange-100'
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    {log.status === 'success'
                      ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                      : <AlertCircle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${log.status === 'error' ? 'text-red-600' : 'text-orange-600'}`} />}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 capitalize">
                        {log.tipo}
                        <span className="font-normal text-gray-500 ml-2 text-xs">
                          {log.sincronizados} reg.
                          {log.erros > 0 && <span className="text-red-500"> · {log.erros} erros</span>}
                          {log.totalSuap > 0 && ` de ${log.totalSuap} SUAP`}
                        </span>
                      </p>
                      {log.mensagem && (
                        <details className="mt-1">
                          <summary className="text-xs text-gray-400 cursor-pointer">Ver log</summary>
                          <pre className="text-xs mt-1 whitespace-pre-wrap font-mono text-gray-600 bg-white/60 rounded p-2 max-h-32 overflow-auto">
                            {log.mensagem}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 flex-shrink-0">
                    {new Date(log.createdAt).toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Guia OAuth2 ─── */}
      <OAuthGuide />
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function SyncCard({
  title, description, icon: Icon, color, disabled, loading,
  onSync, onDryRun, onForce, lastLog,
}: {
  title: string; description: string;
  icon: React.ElementType; color: 'azul' | 'roxo';
  disabled: boolean; loading: boolean;
  onSync: () => void; onDryRun: () => void; onForce?: () => void;
  lastLog?: { createdAt: string; status: string; sincronizados: number };
}) {
  const colorMap = {
    azul: 'bg-azul-eletrico/10 text-azul-eletrico border-azul-eletrico/20',
    roxo: 'bg-roxo-luminoso/10 text-roxo-luminoso border-roxo-luminoso/20',
  };
  const btnColor = color === 'azul'
    ? 'bg-azul-eletrico hover:bg-azul-eletrico/90 text-white'
    : 'bg-roxo-luminoso hover:bg-roxo-luminoso/90 text-white';

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${colorMap[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{description}</p>
        </div>
      </div>

      {lastLog && (
        <div className="mb-4 p-2.5 bg-gray-50 rounded-lg border border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>Última sync: {new Date(lastLog.createdAt).toLocaleDateString('pt-BR')}</span>
          <span className={lastLog.status === 'success' ? 'text-green-600' : 'text-orange-600'}>
            {lastLog.sincronizados} registros
          </span>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onSync}
          disabled={disabled || loading}
          className={`flex items-center justify-center gap-2 flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${btnColor} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {loading ? (
            <><RefreshCw className="w-4 h-4 animate-spin" /> Sincronizando...</>
          ) : (
            <><Play className="w-4 h-4" /> Sincronizar</>
          )}
        </button>
        <button
          onClick={onDryRun}
          disabled={disabled || loading}
          title="Simula a sync sem salvar dados"
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <Search className="w-4 h-4" />
          Testar
        </button>
      </div>

      {/* Sync forçada: por padrão o sync NÃO sobrescreve registros editados
          manualmente no portal (ROADMAP 5.5). Este botão é a válvula de escape. */}
      {onForce && (
        <button
          onClick={onForce}
          disabled={disabled || loading}
          title="Sobrescreve também os registros editados manualmente no portal"
          className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs border border-amber-200 text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Sync forçada (sobrescrever edições manuais)
        </button>
      )}
      {disabled && (
        <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          Configure o SUAP primeiro
        </p>
      )}
    </div>
  );
}

function OAuthGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-azul-eletrico" />
          <span className="font-bold text-gray-900">Guia: Configurar OAuth2 no SUAP</span>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
      </button>

      {open && (
        <div className="px-5 pb-6 space-y-6 border-t border-gray-100 pt-5">

          {/* Passo 1 */}
          <Step n={1} title="Acesse as aplicações OAuth2 no SUAP">
            <a href="https://suap.ifpr.edu.br/api/oauth2/applications/"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-azul-eletrico hover:underline">
              <ExternalLink className="w-4 h-4" />
              suap.ifpr.edu.br/api/oauth2/applications/
            </a>
          </Step>

          {/* Passo 2 */}
          <Step n={2} title='Edite "PortalConecta" — mude para Client credentials'>
            <div className="rounded-xl border border-gray-200 overflow-hidden text-sm mt-2">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Campo</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Valor</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Obs</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Authorization grant type', 'Client credentials ✅', 'Mude de Authorization code'],
                    ['Client type', 'Confidential', ''],
                    ['Redirect URIs', '(deixar vazio)', 'Não precisa para Client credentials'],
                    ['Algorithm', 'HMAC with SHA-2 256', ''],
                    ['Ativo', '✅ Marcado', ''],
                  ].map(([campo, valor, obs]) => (
                    <tr key={campo} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2 font-medium text-gray-700 text-xs">{campo}</td>
                      <td className="px-3 py-2 font-mono text-xs">{valor}</td>
                      <td className="px-3 py-2 text-xs text-gray-400">{obs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 p-3 bg-yellow-50 rounded-xl border border-yellow-200 text-xs text-yellow-800">
              <strong>O erro que apareceu:</strong> &quot;redirect_uris cannot be empty with grant_type authorization-code&quot;
              — ocorre porque Authorization code exige redirect URI.
              Mude para <strong>Client credentials</strong> e o erro some.
            </div>
          </Step>

          {/* Passo 3 */}
          <Step n={3} title="Copie as credenciais para o .env.local">
            <pre className="bg-gray-900 text-green-400 rounded-xl p-4 text-xs font-mono leading-relaxed overflow-x-auto mt-2">{
`# .env.local
SUAP_CLIENT_ID=cole-o-client-id-aqui
SUAP_CLIENT_SECRET=cole-o-client-secret-aqui
SUAP_BASE_URL=https://suap.ifpr.edu.br
SUAP_CAMPUS=Ivaiporã`}</pre>
            <p className="text-xs text-gray-500 mt-1.5">
              ⚠️ O Client Secret só aparece <strong>uma vez</strong>. Copie imediatamente após salvar.
            </p>
          </Step>

          {/* Passo 4 */}
          <Step n={4} title="Reinicie o servidor e teste a conexão" color="green">
            <pre className="bg-gray-900 text-green-400 rounded-xl p-3 text-xs font-mono mt-2">{`npm run dev`}</pre>
            <p className="text-xs text-gray-500 mt-1.5">Depois clique em <strong>&quot;Testar&quot;</strong> no topo desta página para confirmar a conexão.</p>
          </Step>

          {/* Bonus */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-dourado-ifizinha" />
              Bônus: Login com conta SUAP (segundo app)
            </p>
            <div className="rounded-xl border border-gray-200 overflow-hidden text-xs">
              <table className="w-full">
                <tbody>
                  {[
                    ['Grant type', 'Authorization code'],
                    ['Redirect URI (dev)', 'http://localhost:3000/api/auth/callback/suap'],
                    ['Redirect URI (prod)', 'https://seu-dominio.vercel.app/api/auth/callback/suap'],
                  ].map(([k, v]) => (
                    <tr key={k} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2 font-medium text-gray-700 w-2/5">{k}</td>
                      <td className="px-3 py-2 font-mono text-gray-600">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Step({ n, title, children, color = 'blue' }: {
  n: number; title: string; children: React.ReactNode; color?: 'blue' | 'green';
}) {
  const bg = color === 'green' ? 'bg-green-600' : 'bg-azul-eletrico';
  return (
    <div className="flex gap-4">
      <div className={`w-7 h-7 ${bg} text-white rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5`}>
        {n}
      </div>
      <div className="flex-1">
        <p className="font-semibold text-gray-900 text-sm mb-1">{title}</p>
        {children}
      </div>
    </div>
  );
}
