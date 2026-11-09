'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCheck, ExternalLink, Eye, Mail, RotateCcw, Trash2, User } from 'lucide-react';
import { atualizarStatusFeedback, excluirFeedback, type ListaFeedbacks } from '@/actions/feedback';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { ROTULO_STATUS_FEEDBACK, STATUS_FEEDBACK, rotuloDoTipo, type StatusFeedback } from '@/lib/feedback';

const COR_STATUS: Record<StatusFeedback, string> = {
  novo: 'bg-blue-100 text-blue-700',
  lido: 'bg-gray-100 text-gray-700',
  resolvido: 'bg-green-100 text-green-700',
};

function hrefFiltro(status?: string, pagina = 1) {
  const p = new URLSearchParams();
  if (status) p.set('status', status);
  if (pagina > 1) p.set('pagina', String(pagina));
  const q = p.toString();
  return `/admin/feedbacks${q ? `?${q}` : ''}`;
}

const formatarData = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

export function FeedbacksPainel({ dados, statusAtual }: { dados: ListaFeedbacks; statusAtual?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pendente, iniciar] = useTransition();
  const [paraExcluir, setParaExcluir] = useState<string | null>(null);

  const totalGeral = dados.contagem.novo + dados.contagem.lido + dados.contagem.resolvido;
  const totalPaginas = Math.max(1, Math.ceil(dados.total / dados.porPagina));

  function mudarStatus(id: string, status: StatusFeedback) {
    iniciar(async () => {
      const r = await atualizarStatusFeedback(id, status);
      if (!r.ok) toast(r.error, 'error');
      else router.refresh();
    });
  }

  function confirmarExclusao() {
    const id = paraExcluir;
    if (!id) return;
    iniciar(async () => {
      const r = await excluirFeedback(id);
      setParaExcluir(null);
      if (!r.ok) toast(r.error, 'error');
      else {
        toast('Mensagem excluída.');
        router.refresh();
      }
    });
  }

  const abas: { valor?: StatusFeedback; rotulo: string; total: number }[] = [
    { rotulo: 'Todas', total: totalGeral },
    ...STATUS_FEEDBACK.map((s) => ({ valor: s, rotulo: ROTULO_STATUS_FEEDBACK[s], total: dados.contagem[s] })),
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-black text-gray-900">Feedback dos visitantes</h1>
      <p className="mt-1 text-sm text-gray-500">
        Mensagens enviadas em{' '}
        <Link href="/feedback" className="font-semibold text-azul-eletrico hover:underline">
          /feedback
        </Link>
        . Cada mensagem nova também aparece no sino do portal.
      </p>

      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Filtrar por situação">
        {abas.map((a) => {
          const ativa = (statusAtual ?? '') === (a.valor ?? '');
          return (
            <Link
              key={a.rotulo}
              href={hrefFiltro(a.valor)}
              role="tab"
              aria-selected={ativa}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                ativa ? 'bg-azul-eletrico text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              {a.rotulo} <span className="opacity-70">({a.total})</span>
            </Link>
          );
        })}
      </div>

      {dados.itens.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-500">
          Nenhuma mensagem {statusAtual ? `com a situação "${ROTULO_STATUS_FEEDBACK[statusAtual as StatusFeedback] ?? statusAtual}"` : 'recebida ainda'}.
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {dados.itens.map((f) => (
            <li
              key={f.id}
              className={`rounded-2xl border bg-white p-5 shadow-sm ${f.status === 'novo' ? 'border-azul-eletrico/40' : 'border-gray-100'}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${COR_STATUS[f.status]}`}>
                  {ROTULO_STATUS_FEEDBACK[f.status]}
                </span>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
                  {rotuloDoTipo(f.tipo)}
                </span>
                <span className="ml-auto text-xs text-gray-400">{formatarData(f.criadoEm)}</span>
              </div>

              {/* Texto puro: o React escapa o conteúdo, nada vindo do visitante vira HTML. */}
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">{f.mensagem}</p>

              <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
                {f.autor && (
                  <div className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5" />
                    <dd>{f.autor.nome ? `${f.autor.nome} · ${f.autor.email}` : f.autor.email}</dd>
                  </div>
                )}
                {f.contato && (
                  <div className="flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5" />
                    <dd>
                      <a href={`mailto:${f.contato}`} className="text-azul-eletrico hover:underline">
                        {f.contato}
                      </a>
                    </dd>
                  </div>
                )}
                {f.pagina && (
                  <div className="flex items-center gap-1">
                    <ExternalLink className="h-3.5 w-3.5" />
                    <dd>
                      <Link href={f.pagina} className="text-azul-eletrico hover:underline" target="_blank">
                        {f.pagina}
                      </Link>
                    </dd>
                  </div>
                )}
                {!f.autor && !f.contato && <div>Anônimo, sem e-mail para resposta</div>}
              </dl>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                {f.status === 'novo' && (
                  <button disabled={pendente} onClick={() => mudarStatus(f.id, 'lido')} className={BOTAO}>
                    <Eye className="h-3.5 w-3.5" /> Marcar como lida
                  </button>
                )}
                {f.status !== 'resolvido' && (
                  <button disabled={pendente} onClick={() => mudarStatus(f.id, 'resolvido')} className={BOTAO}>
                    <CheckCheck className="h-3.5 w-3.5" /> Marcar como resolvida
                  </button>
                )}
                {f.status !== 'novo' && (
                  <button disabled={pendente} onClick={() => mudarStatus(f.id, 'novo')} className={BOTAO}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                  </button>
                )}
                <button
                  disabled={pendente}
                  onClick={() => setParaExcluir(f.id)}
                  className={`${BOTAO} ml-auto text-red-600 hover:bg-red-50`}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPaginas > 1 && (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Paginação">
          {dados.pagina > 1 ? (
            <Link href={hrefFiltro(statusAtual, dados.pagina - 1)} className="font-semibold text-azul-eletrico hover:underline">
              ← Mais recentes
            </Link>
          ) : <span />}
          <span className="text-gray-500">Página {dados.pagina} de {totalPaginas}</span>
          {dados.pagina < totalPaginas ? (
            <Link href={hrefFiltro(statusAtual, dados.pagina + 1)} className="font-semibold text-azul-eletrico hover:underline">
              Mais antigas →
            </Link>
          ) : <span />}
        </nav>
      )}

      <ConfirmDialog
        open={paraExcluir !== null}
        title="Excluir esta mensagem?"
        description="A mensagem será apagada de vez e não dá para desfazer. Se quiser só tirá-la da frente, use “Marcar como resolvida”."
        loading={pendente}
        onConfirm={confirmarExclusao}
        onCancel={() => setParaExcluir(null)}
      />
    </div>
  );
}

const BOTAO =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50';
