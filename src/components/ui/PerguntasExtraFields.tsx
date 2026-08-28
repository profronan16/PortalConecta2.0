import React from 'react';
import { Field, Fieldset } from '@/components/ui/FormFieldPrimitives';
import { nomeCampoExtra, type PerguntaExtra } from '@/lib/formulario-extra';

/** Renderiza as perguntas extras configuradas pelo coordenador dentro do `<form>` público de inscrição. */
export function PerguntasExtraFields({ perguntas }: { perguntas: PerguntaExtra[] }) {
  if (perguntas.length === 0) return null;

  return (
    <>
      {perguntas.map((p) => {
        const campo = nomeCampoExtra(p.id);

        if (p.tipo === 'declaracao') {
          return (
            <label key={p.id} className="flex items-start gap-3 cursor-pointer p-3 rounded-xl hover:bg-gray-50 border border-gray-100">
              <input type="checkbox" name={campo} required={p.obrigatoria} className="w-4 h-4 mt-0.5 accent-azul-eletrico" />
              <span className="text-sm text-gray-600">
                {p.pergunta}{p.obrigatoria && ' *'}
              </span>
            </label>
          );
        }

        if (p.tipo === 'texto_curto') {
          return (
            <Field key={p.id} label={p.pergunta} required={p.obrigatoria}>
              <input name={campo} type="text" required={p.obrigatoria} className="input-field" />
            </Field>
          );
        }

        if (p.tipo === 'texto_longo') {
          return (
            <Field key={p.id} label={p.pergunta} required={p.obrigatoria}>
              <textarea name={campo} required={p.obrigatoria} className="input-field min-h-[100px] resize-none" />
            </Field>
          );
        }

        if (p.tipo === 'unica_escolha') {
          return (
            <Fieldset key={p.id} label={p.pergunta} required={p.obrigatoria}>
              <div className="space-y-1.5">
                {(p.opcoes ?? []).map((op) => (
                  <label key={op} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name={campo} value={op} required={p.obrigatoria} className="w-4 h-4 accent-azul-eletrico" />
                    <span className="text-sm text-gray-700">{op}</span>
                  </label>
                ))}
              </div>
            </Fieldset>
          );
        }

        // multipla_escolha
        return (
          <Fieldset key={p.id} label={p.pergunta} required={p.obrigatoria}>
            <div className="space-y-1.5">
              {(p.opcoes ?? []).map((op) => (
                <label key={op} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" name={campo} value={op} className="w-4 h-4 accent-azul-eletrico" />
                  <span className="text-sm text-gray-700">{op}</span>
                </label>
              ))}
            </div>
          </Fieldset>
        );
      })}
    </>
  );
}
