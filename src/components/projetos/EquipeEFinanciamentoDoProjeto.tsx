'use client';

import React from 'react';
import { GraduationCap } from 'lucide-react';
import { ListaDeTextosEditor } from '@/components/ui/ListaDeTextosEditor';
import {
  FINANCIAMENTOS_SUGERIDOS,
  LIMITES_EQUIPE,
  type EquipeDoProjeto,
} from '@/lib/projetos-equipe';

/**
 * Bloco "Equipe e financiamento" do projeto — a fonte única usada no painel do
 * professor, no painel do admin, na "Página do projeto" e na tela de gestão.
 * Os quatro mostram exatamente os mesmos campos, na mesma ordem.
 *
 *  - Vice-coordenação: nome e e-mail (o e-mail dá acesso ao painel do projeto,
 *    por isso só coordenação/admin edita — `podeEditarVice`).
 *  - Estudantes: SOMENTE LEITURA. Vêm das inscrições (selecionado + aceitou a
 *    convocação) e aparecem sozinhos na página pública, logo abaixo do resumo.
 *    Para mudar quem está na equipe, muda-se a situação da inscrição.
 *  - Financiamento: selos exibidos junto ao resumo na página pública.
 */

export type EquipeEFinanciamentoValores = {
  financiamento?: string[] | null;
  viceCoordenadorNome?: string | null;
  viceCoordenadorEmail?: string | null;
};

/** O que o bloco devolve ao mudar: nunca `null`, para encaixar em qualquer formulário. */
export type AlteracaoDaEquipe = {
  financiamento?: string[];
  viceCoordenadorNome?: string;
  viceCoordenadorEmail?: string;
};

export function EquipeEFinanciamentoDoProjeto({
  valores,
  onChange,
  equipe,
  podeEditarVice = true,
}: {
  valores: EquipeEFinanciamentoValores;
  /** Devolve só o que mudou; quem chama faz o merge no próprio formulário. */
  onChange: (alteracao: AlteracaoDaEquipe) => void;
  /** Equipe vinda das inscrições. `undefined` = projeto ainda não existe (oculta o bloco). */
  equipe?: EquipeDoProjeto | null;
  podeEditarVice?: boolean;
}) {
  return (
    <>
      <div className="border-b pb-2">
        <h3 className="text-sm font-bold text-gray-900">Vice-coordenação</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Aparece na página pública. {podeEditarVice
            ? 'O e-mail dá acesso ao painel deste projeto — use o e-mail institucional (@ifpr.edu.br).'
            : 'Só a coordenação do projeto altera este campo.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label-field">Vice-coordenador (nome)</label>
          <input
            className="input-field disabled:opacity-50 disabled:bg-gray-50"
            value={valores.viceCoordenadorNome ?? ''}
            onChange={(e) => onChange({ viceCoordenadorNome: e.target.value })}
            disabled={!podeEditarVice}
          />
        </div>
        <div>
          <label className="label-field">Vice-coordenador (e-mail)</label>
          <input
            type="email"
            className="input-field disabled:opacity-50 disabled:bg-gray-50"
            placeholder="vice@ifpr.edu.br"
            value={valores.viceCoordenadorEmail ?? ''}
            onChange={(e) => onChange({ viceCoordenadorEmail: e.target.value })}
            disabled={!podeEditarVice}
          />
        </div>
      </div>

      {equipe !== undefined && (
        <>
          <div className="border-b pb-2 pt-2">
            <h3 className="text-sm font-bold text-gray-900">Estudantes do Projeto</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Vêm das inscrições: aparecem na página pública, logo abaixo do resumo, os estudantes
              <strong> selecionados que aceitaram a convocação</strong>. Para mudar a lista, altere a
              situação da inscrição.
            </p>
          </div>

          {equipe === null ? (
            <p className="text-xs text-gray-400">Carregando estudantes...</p>
          ) : equipe.total === 0 ? (
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-3">
              Nenhum estudante na equipe ainda. Quando um selecionado aceitar a convocação, ele
              aparece aqui e na página pública.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <NomesDaEquipe rotulo="Bolsistas" nomes={equipe.bolsistas} cor="blue" />
              <NomesDaEquipe rotulo="Voluntários" nomes={equipe.voluntarios} cor="purple" />
            </div>
          )}
        </>
      )}

      <div className="border-b pb-2 pt-2">
        <h3 className="text-sm font-bold text-gray-900">Financiamento</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          De onde vem o recurso do projeto. As fontes cadastradas aparecem como selos junto ao
          resumo (ex.: IFPR, CNPq, Fundação Araucária, emenda parlamentar).
        </p>
      </div>

      <ListaDeTextosEditor
        rotulo="Fontes financiadoras"
        valores={valores.financiamento}
        onChange={(v) => onChange({ financiamento: v })}
        placeholder="Outra fonte (ex.: PIBEX, edital interno)"
        sugestoes={FINANCIAMENTOS_SUGERIDOS}
        maxItens={LIMITES_EQUIPE.financiamento.maxItens}
        maxItem={LIMITES_EQUIPE.financiamento.maxItem}
      />
    </>
  );
}

const CORES_DA_EQUIPE = {
  blue: { titulo: 'text-blue-700', chip: 'bg-blue-50 text-blue-800 border-blue-100' },
  purple: { titulo: 'text-purple-700', chip: 'bg-purple-50 text-purple-800 border-purple-100' },
} as const;

function NomesDaEquipe({
  rotulo,
  nomes,
  cor,
}: {
  rotulo: string;
  nomes: string[];
  cor: keyof typeof CORES_DA_EQUIPE;
}) {
  const estilo = CORES_DA_EQUIPE[cor];
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 ${estilo.titulo}`}>
        <GraduationCap className="w-3.5 h-3.5" />
        {rotulo} ({nomes.length})
      </p>
      {nomes.length === 0 ? (
        <p className="text-xs text-gray-400">Nenhum.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {nomes.map((nome) => (
            <li
              key={nome}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border ${estilo.chip}`}
            >
              {nome}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
