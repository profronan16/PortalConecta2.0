'use client';

import React from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { PerguntaExtra, TipoPerguntaExtra, TIPOS_PERGUNTA_EXTRA, novoIdPerguntaExtra } from '@/lib/formulario-extra';

/** Editor de perguntas extras do formulário de inscrição — dá liberdade ao coordenador de escolher o que quer perguntar, além dos campos padrão. */
export function FormularioExtraEditor({ value, onChange }: { value: PerguntaExtra[]; onChange: (v: PerguntaExtra[]) => void }) {
  const addPergunta = () => {
    onChange([...value, { id: novoIdPerguntaExtra(), tipo: 'texto_curto', pergunta: '', obrigatoria: false }]);
  };

  const updatePergunta = (id: string, patch: Partial<PerguntaExtra>) => {
    onChange(value.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removePergunta = (id: string) => {
    onChange(value.filter((p) => p.id !== id));
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-xs text-gray-400 italic">
          Nenhuma pergunta extra ainda — o formulário de inscrição usará só os campos padrão (nome, e-mail, curso etc.).
        </p>
      )}

      {value.map((pergunta, i) => (
        <div key={pergunta.id} className="border border-gray-200 rounded-xl p-3 bg-gray-50/60">
          <div className="flex items-start gap-2">
            <div className="flex flex-col gap-0.5 pt-1.5 flex-shrink-0">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-colors" aria-label="Mover pergunta para cima">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-colors" aria-label="Mover pergunta para baixo">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 min-w-0 space-y-2">
              <input
                className="input-field text-sm"
                placeholder={pergunta.tipo === 'declaracao' ? 'Texto da declaração (ex: Declaro que estou ciente das regras)' : 'Texto da pergunta'}
                value={pergunta.pergunta}
                onChange={(e) => updatePergunta(pergunta.id, { pergunta: e.target.value })}
              />

              <div className="flex items-center gap-3 flex-wrap">
                <select
                  className="input-field text-xs py-1.5 w-auto"
                  value={pergunta.tipo}
                  onChange={(e) => updatePergunta(pergunta.id, { tipo: e.target.value as TipoPerguntaExtra })}
                >
                  {TIPOS_PERGUNTA_EXTRA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pergunta.obrigatoria}
                    onChange={(e) => updatePergunta(pergunta.id, { obrigatoria: e.target.checked })}
                    className="w-3.5 h-3.5 accent-azul-eletrico"
                  />
                  Obrigatória
                </label>
              </div>

              {(pergunta.tipo === 'unica_escolha' || pergunta.tipo === 'multipla_escolha') && (
                <OpcoesEditor
                  opcoes={pergunta.opcoes ?? []}
                  onChange={(opcoes) => updatePergunta(pergunta.id, { opcoes })}
                />
              )}
            </div>

            <button
              type="button"
              onClick={() => removePergunta(pergunta.id)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
              aria-label="Remover pergunta"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addPergunta}
        className="flex items-center gap-1.5 text-sm font-medium text-azul-eletrico hover:underline"
      >
        <Plus className="w-4 h-4" /> Adicionar pergunta
      </button>
    </div>
  );
}

function OpcoesEditor({ opcoes, onChange }: { opcoes: string[]; onChange: (opcoes: string[]) => void }) {
  const updateOpcao = (i: number, v: string) => {
    const next = [...opcoes];
    next[i] = v;
    onChange(next);
  };
  const removeOpcao = (i: number) => onChange(opcoes.filter((_, idx) => idx !== i));
  const addOpcao = () => onChange([...opcoes, '']);

  return (
    <div className="space-y-1.5 pl-1 pt-1 border-t border-gray-200/70">
      <p className="text-xs text-gray-400 pt-1.5">Opções de resposta:</p>
      {opcoes.map((op, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            className="input-field text-xs py-1"
            value={op}
            placeholder={`Opção ${i + 1}`}
            onChange={(e) => updateOpcao(i, e.target.value)}
          />
          <button type="button" onClick={() => removeOpcao(i)} className="text-gray-400 hover:text-red-500 flex-shrink-0 text-sm px-1" aria-label="Remover opção">
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={addOpcao} className="text-xs text-azul-eletrico hover:underline">
        + opção
      </button>
    </div>
  );
}
