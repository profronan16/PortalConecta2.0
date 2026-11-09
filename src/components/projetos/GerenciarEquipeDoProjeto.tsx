'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, UserMinus } from 'lucide-react';
import {
  definirGestorDaPagina,
  listarEquipeParaGestao,
  removerDaEquipe,
  type MembroParaGestao,
} from '@/actions/professor';
import { ConvidarEstudanteDoProjeto } from '@/components/projetos/ConvidarEstudanteDoProjeto';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Lado da COORDENAÇÃO do bloco "Estudantes do Projeto": quem está na equipe e
 * quem tem convite aguardando resposta, com cancelar/remover e cargo de gestor
 * da página, mais o botão "Convidar estudante". As regras ficam no servidor
 * (`removerDaEquipe`, `definirGestorDaPagina`); aqui é só a tela.
 */

const ROTULO_PAPEL = { bolsista: 'Bolsista', voluntario: 'Voluntário' } as const;

export function GerenciarEquipeDoProjeto({
  projetoId,
  userEmail,
  onAlterada,
}: {
  projetoId: string;
  userEmail: string;
  /** Chamado quando a equipe mudou (convite, remoção, gestor): a tela recarrega o que depende dela. */
  onAlterada?: () => void;
}) {
  const [membros, setMembros] = useState<MembroParaGestao[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [remover, setRemover] = useState<MembroParaGestao | null>(null);
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null);

  const recarregar = useCallback(async () => {
    const r = await listarEquipeParaGestao(projetoId, userEmail).catch(() => null);
    if (r?.ok) setMembros(r.data ?? []);
    else setMembros((atual) => atual ?? []);
  }, [projetoId, userEmail]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const aposMudanca = async () => {
    await recarregar();
    onAlterada?.();
  };

  const alternarGestor = async (m: MembroParaGestao) => {
    if (!m.userId) return;
    setOcupado(m.inscricaoId);
    setMensagem(null);
    const r = await definirGestorDaPagina(projetoId, m.userId, !m.gestor, userEmail).catch(() => null);
    setOcupado(null);
    if (!r || !r.ok) {
      setMensagem({ texto: r?.error ?? 'Não conseguimos alterar o cargo agora. Tente de novo.', erro: true });
      return;
    }
    setMensagem({
      texto: m.gestor ? `${m.nome} não é mais gestor(a) da página.` : `${m.nome} agora é gestor(a) da página.`,
      erro: false,
    });
    await aposMudanca();
  };

  const confirmarRemocao = async () => {
    if (!remover) return;
    setOcupado(remover.inscricaoId);
    setMensagem(null);
    const r = await removerDaEquipe(projetoId, remover.inscricaoId, userEmail).catch(() => null);
    setOcupado(null);
    setRemover(null);
    if (!r || !r.ok) {
      setMensagem({ texto: r?.error ?? 'Não conseguimos remover agora. Tente de novo.', erro: true });
      return;
    }
    setMensagem({
      texto: r.data?.cancelouConvite
        ? `Convite de ${r.data.nome} cancelado.`
        : `${r.data?.nome ?? 'O estudante'} foi removido(a) da equipe.`,
      erro: false,
    });
    await aposMudanca();
  };

  return (
    <div className="space-y-3">
      {membros && membros.length > 0 && (
        <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 bg-white">
          <p className="px-3 py-2 text-xs font-bold text-gray-900">Gerenciar equipe e convites</p>
          {membros.map((m) => {
            const trabalhando = ocupado === m.inscricaoId;
            return (
              <div key={m.inscricaoId} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-sm font-medium text-gray-900 truncate">{m.nome}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {ROTULO_PAPEL[m.papel]} · {m.email}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                      m.aguardando
                        ? 'bg-amber-50 text-amber-700 border-amber-100'
                        : 'bg-green-50 text-green-700 border-green-100'
                    }`}
                  >
                    {m.aguardando ? 'Aguardando resposta' : 'Na equipe'}
                  </span>
                  {m.gestor && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border bg-blue-50 text-blue-700 border-blue-100">
                      Gestor da página
                    </span>
                  )}
                  {!m.aguardando && m.userId && (
                    <button
                      type="button"
                      onClick={() => alternarGestor(m)}
                      disabled={trabalhando}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#2F52D3] border border-[#2F52D3]/30 hover:bg-[#2F52D3]/5 disabled:opacity-50 rounded-lg px-2 py-1"
                    >
                      {trabalhando ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                      {m.gestor ? 'Remover gestão' : 'Tornar gestor(a)'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRemover(m)}
                    disabled={trabalhando}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50 rounded-lg px-2 py-1"
                  >
                    <UserMinus className="w-3 h-3" />
                    {m.aguardando ? 'Cancelar convite' : 'Remover'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {mensagem && (
        <p
          role="status"
          className={`text-xs rounded-lg px-3 py-2 border ${
            mensagem.erro ? 'text-red-700 bg-red-50 border-red-100' : 'text-green-700 bg-green-50 border-green-100'
          }`}
        >
          {mensagem.texto}
        </p>
      )}

      <ConvidarEstudanteDoProjeto
        projetoId={projetoId}
        userEmail={userEmail}
        onConvidado={() => {
          void aposMudanca();
        }}
      />

      <ConfirmDialog
        open={!!remover}
        variant="warning"
        title={remover?.aguardando ? 'Cancelar este convite?' : 'Remover da equipe?'}
        description={
          remover
            ? remover.aguardando
              ? `${remover.nome} deixa de ter este convite pendente. Quem recebeu já foi avisado por e-mail, mas o convite não vale mais.`
              : `${remover.nome} sai da equipe e da página pública do projeto, e perde o cargo de gestor da página, se tiver.`
            : ''
        }
        confirmLabel={remover?.aguardando ? 'Cancelar convite' : 'Remover da equipe'}
        cancelLabel="Voltar"
        loading={!!remover && ocupado === remover.inscricaoId}
        loadingLabel="Removendo..."
        onConfirm={confirmarRemocao}
        onCancel={() => !ocupado && setRemover(null)}
      />
    </div>
  );
}
