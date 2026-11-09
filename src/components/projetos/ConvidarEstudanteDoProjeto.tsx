'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Search, UserPlus, X } from 'lucide-react';
import {
  buscarEstudantesParaConvite,
  convidarEstudante,
  type EstudanteBuscado,
} from '@/actions/professor';
import {
  MINIMO_DA_BUSCA,
  ROTULO_TIPO_DO_CONVITE,
  TIPOS_DE_CONVITE,
  type TipoDoConvite,
} from '@/lib/convite-estudante';

/**
 * "Convidar estudante" — a coordenação adiciona alguém à equipe sem esperar a
 * inscrição. Com "Pedir confirmação" marcada o estudante aceita/recusa em "Meus
 * Dados"; desmarcada, ele entra direto. As regras ficam no servidor
 * (`convidarEstudante`): aqui é só a tela.
 */

const SITUACAO_NA_BUSCA = {
  na_equipe: 'Já está na equipe',
  convidado: 'Convite aguardando resposta',
} as const;

export function ConvidarEstudanteDoProjeto({
  projetoId,
  userEmail,
  onConvidado,
}: {
  projetoId: string;
  userEmail: string;
  /** Chamado depois de um convite gravado, para a tela recarregar a equipe. */
  onConvidado?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<EstudanteBuscado[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [escolhido, setEscolhido] = useState<EstudanteBuscado | null>(null);
  const [tipo, setTipo] = useState<TipoDoConvite>('VOLUNTARIO');
  const [pedirConfirmacao, setPedirConfirmacao] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null);
  // Só a busca mais recente pode atualizar a lista (digitar rápido dispara várias).
  const ultimaBusca = useRef(0);

  useEffect(() => {
    if (!aberto || escolhido) return;
    const limpo = termo.trim();
    if (limpo.length < MINIMO_DA_BUSCA) {
      setResultados(null);
      setBuscando(false);
      return;
    }
    const numero = ++ultimaBusca.current;
    setBuscando(true);
    const espera = setTimeout(async () => {
      const r = await buscarEstudantesParaConvite(projetoId, limpo, userEmail).catch(() => null);
      if (numero !== ultimaBusca.current) return;
      setBuscando(false);
      if (!r) {
        setMensagem({ texto: 'Não conseguimos buscar agora. Tente de novo.', erro: true });
      } else if (!r.ok) {
        setMensagem({ texto: r.error, erro: true });
      } else {
        setMensagem(null);
        setResultados(r.data ?? []);
      }
    }, 350);
    return () => clearTimeout(espera);
  }, [termo, aberto, escolhido, projetoId, userEmail]);

  const fechar = () => {
    setAberto(false);
    setTermo('');
    setResultados(null);
    setEscolhido(null);
    setPedirConfirmacao(true);
    setTipo('VOLUNTARIO');
  };

  const enviar = async () => {
    if (!escolhido) return;
    setEnviando(true);
    setMensagem(null);
    const r = await convidarEstudante(
      projetoId,
      { userId: escolhido.userId, tipo, pedirConfirmacao },
      userEmail,
    ).catch(() => null);
    setEnviando(false);
    if (!r) {
      setMensagem({ texto: 'Não conseguimos enviar o convite. Tente de novo.', erro: true });
      return;
    }
    if (!r.ok) {
      setMensagem({ texto: r.error, erro: true });
      return;
    }
    const nome = r.data?.nome ?? escolhido.nome;
    setMensagem({
      texto: r.data?.aguardandoConfirmacao
        ? `Convite enviado para ${nome}. Ele(a) aparece na equipe quando aceitar.`
        : `${nome} foi adicionado(a) à equipe.`,
      erro: false,
    });
    fechar();
    onConvidado?.();
  };

  return (
    <div className="space-y-2">
      {!aberto && (
        <button
          type="button"
          onClick={() => { setAberto(true); setMensagem(null); }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2F52D3] border border-[#2F52D3]/30 hover:bg-[#2F52D3]/5 rounded-lg px-3 py-1.5"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Convidar estudante
        </button>
      )}

      {aberto && (
        <div className="border border-gray-200 rounded-xl p-3 space-y-3 bg-gray-50/60">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-gray-900">Convidar estudante</p>
            <button type="button" onClick={fechar} aria-label="Fechar convite" className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          {escolhido ? (
            <div className="flex items-center justify-between gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{escolhido.nome}</p>
                <p className="text-xs text-gray-500 truncate">{escolhido.email}</p>
              </div>
              <button
                type="button"
                onClick={() => { setEscolhido(null); setMensagem(null); }}
                className="text-xs text-[#2F52D3] font-semibold shrink-0"
              >
                Trocar
              </button>
            </div>
          ) : (
            <div>
              <label className="label-field" htmlFor="convite-busca">Estudante</label>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="convite-busca"
                  className="input-field pl-9"
                  placeholder="Nome, e-mail ou matrícula"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  // O bloco fica dentro do formulário de edição: Enter aqui não pode salvar o projeto.
                  onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                  autoComplete="off"
                />
                {buscando && <Loader2 className="w-4 h-4 animate-spin text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />}
              </div>
              {resultados !== null && !buscando && (
                resultados.length === 0 ? (
                  <p className="text-xs text-gray-500 mt-2">
                    Nenhum estudante encontrado. Só aparecem estudantes que já entraram no portal.
                  </p>
                ) : (
                  <ul className="mt-2 border border-gray-200 rounded-lg bg-white divide-y divide-gray-100 max-h-56 overflow-auto">
                    {resultados.map((e) => (
                      <li key={e.userId}>
                        <button
                          type="button"
                          disabled={e.situacao !== null}
                          onClick={() => { setEscolhido(e); setMensagem(null); }}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white"
                        >
                          <span className="block text-sm font-medium text-gray-900">{e.nome}</span>
                          <span className="block text-xs text-gray-500">
                            {e.email}{e.curso ? ` · ${e.curso}` : ''}
                            {e.situacao ? ` — ${SITUACAO_NA_BUSCA[e.situacao]}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          )}

          <fieldset>
            <legend className="label-field">Entra como</legend>
            <div className="flex gap-4">
              {TIPOS_DE_CONVITE.map((t) => (
                <label key={t} className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="convite-tipo"
                    checked={tipo === t}
                    onChange={() => setTipo(t)}
                  />
                  {ROTULO_TIPO_DO_CONVITE[t]}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={pedirConfirmacao}
              onChange={(e) => setPedirConfirmacao(e.target.checked)}
            />
            <span>
              <strong>Pedir confirmação</strong>
              <span className="block text-xs text-gray-500">
                {pedirConfirmacao
                  ? 'O estudante aceita ou recusa em "Meus Dados". Só entra na equipe depois de aceitar.'
                  : 'Desmarcado: o estudante entra direto na equipe e só recebe um aviso.'}
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={fechar} className="text-xs font-semibold text-gray-600 px-3 py-1.5">
              Cancelar
            </button>
            <button
              type="button"
              onClick={enviar}
              disabled={!escolhido || enviando}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#2F52D3] hover:bg-[#2644b0] disabled:opacity-50 rounded-lg px-3 py-1.5"
            >
              {enviando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {pedirConfirmacao ? 'Enviar convite' : 'Adicionar à equipe'}
            </button>
          </div>
        </div>
      )}

      {mensagem && (
        <p
          role="status"
          className={`text-xs rounded-lg px-3 py-2 border ${
            mensagem.erro
              ? 'text-red-700 bg-red-50 border-red-100'
              : 'text-green-700 bg-green-50 border-green-100'
          }`}
        >
          {mensagem.texto}
        </p>
      )}
    </div>
  );
}
