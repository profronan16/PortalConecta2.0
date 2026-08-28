'use client';

import React, { useState } from 'react';
import { X, Calendar, AlertCircle } from 'lucide-react';

/** Pop-up de configurações essenciais ao abrir inscrições — hoje só pede o prazo, que antes não tinha onde ser definido em lugar nenhum do painel. */
export function AbrirInscricoesModal({
  onConfirm,
  onClose,
}: {
  onConfirm: (data: { inscricaoInicio?: string; inscricaoFim: string }) => Promise<void> | void;
  onClose: () => void;
}) {
  const [inicio, setInicio] = useState(() => new Date().toISOString().split('T')[0]);
  const [fim, setFim] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    if (!fim) {
      setError('Informe o prazo final das inscrições');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onConfirm({ inscricaoInicio: inicio || undefined, inscricaoFim: fim });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-azul-eletrico" />
              Abrir inscrições
            </h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" aria-label="Fechar">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <p className="text-xs text-gray-500 leading-relaxed">
              Defina o período antes de abrir — sem um prazo final, os estudantes não saberão até quando podem se inscrever.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Início das inscrições</label>
              <input
                type="date"
                className="input-field"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Prazo final das inscrições <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                className="input-field"
                value={fim}
                min={inicio}
                onChange={(e) => setFim(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}
          </div>

          <div className="flex gap-3 px-5 py-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-all"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-xl bg-azul-eletrico text-white font-semibold text-sm hover:bg-azul-eletrico/90 transition-all disabled:opacity-60"
            >
              {submitting ? 'Abrindo...' : 'Abrir inscrições'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
