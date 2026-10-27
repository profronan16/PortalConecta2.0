'use client';

import React, { useId, useState } from 'react';
import { Plus, X } from 'lucide-react';

/**
 * Editor de lista curta de nomes/rótulos: digita e adiciona (Enter, vírgula ou
 * o botão), cada item vira um chip removível.
 *
 * Usado no financiamento do projeto (bloco `EquipeEFinanciamentoDoProjeto`).
 * Duas razões para ser chip
 * e não textarea: o mesmo nome não entra duas vezes (o servidor também
 * deduplica) e a página pública renderiza exatamente esses itens — sem
 * regravar texto com quebra de linha para depois adivinhar a lista.
 *
 * O `maxItens`/`maxItem` aqui é conforto; quem recusa de verdade é o servidor
 * (`src/lib/projetos-equipe.ts`), porque a Server Action pode ser chamada
 * direto, sem passar por esta tela.
 */
export function ListaDeTextosEditor({
  rotulo,
  valores,
  onChange,
  placeholder,
  ajuda,
  sugestoes = [],
  maxItens = 20,
  maxItem = 60,
}: {
  rotulo: string;
  valores: string[] | null | undefined;
  onChange: (valores: string[]) => void;
  placeholder?: string;
  ajuda?: React.ReactNode;
  sugestoes?: readonly string[];
  maxItens?: number;
  maxItem?: number;
}) {
  const id = useId();
  const [novo, setNovo] = useState('');
  const lista = valores ?? [];
  const cheio = lista.length >= maxItens;
  const jaTem = (item: string) => lista.some((v) => v.toLowerCase() === item.trim().toLowerCase());

  const adicionar = (texto: string) => {
    // Aceita colar "Ana, Bruno; Carla" e Enter no meio: vira lista de uma vez.
    const partes = texto.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
    if (partes.length === 0) return;

    const proximos = [...lista];
    for (const parte of partes) {
      if (proximos.length >= maxItens) break;
      const item = parte.slice(0, maxItem);
      if (!proximos.some((v) => v.toLowerCase() === item.toLowerCase())) proximos.push(item);
    }
    onChange(proximos);
    setNovo('');
  };

  const remover = (item: string) => onChange(lista.filter((v) => v !== item));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="label-field" htmlFor={id}>{rotulo}</label>
        <span className="text-[11px] text-gray-400 shrink-0">{lista.length}/{maxItens}</span>
      </div>

      {lista.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mb-2">
          {lista.map((item) => (
            <li
              key={item}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium pl-2.5 pr-1 py-1"
            >
              {item}
              <button
                type="button"
                onClick={() => remover(item)}
                aria-label={`Remover ${item}`}
                className="rounded-full p-0.5 text-gray-500 hover:bg-gray-300/60 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          id={id}
          className="input-field text-sm"
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              adicionar(novo);
            }
          }}
          maxLength={maxItem}
          placeholder={cheio ? 'Limite atingido' : (placeholder ?? 'Digite um nome e tecle Enter')}
          disabled={cheio}
        />
        <button
          type="button"
          onClick={() => adicionar(novo)}
          disabled={cheio || !novo.trim()}
          className="shrink-0 inline-flex items-center gap-1 px-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-4 h-4" />
          Adicionar
        </button>
      </div>

      {sugestoes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <span className="text-[11px] text-gray-400">Sugestões:</span>
          {sugestoes.map((sugestao) => {
            const usado = jaTem(sugestao);
            return (
              <button
                key={sugestao}
                type="button"
                onClick={() => adicionar(sugestao)}
                disabled={usado || cheio}
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                  usado
                    ? 'border-gray-100 text-gray-300 cursor-default'
                    : 'border-gray-200 text-gray-600 hover:border-azul-eletrico hover:text-azul-eletrico'
                } disabled:cursor-not-allowed`}
              >
                {sugestao}
              </button>
            );
          })}
        </div>
      )}

      {ajuda && <p className="text-xs text-gray-400 mt-1.5">{ajuda}</p>}
    </div>
  );
}
