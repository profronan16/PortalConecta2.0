'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle, Loader2, Send } from 'lucide-react';
import { enviarFeedback } from '@/actions/feedback';
import { TurnstileWidget } from '@/components/ui/turnstile-widget';
import { CONTATO_MAX, MENSAGEM_MAX, MENSAGEM_MIN, TIPOS_FEEDBACK, type TipoFeedback } from '@/lib/feedback';

/**
 * Formulário público de feedback. Funciona sem login: o e-mail de contato é
 * opcional e serve só para a equipe poder responder.
 */
export function FeedbackForm({ paginaOrigem }: { paginaOrigem?: string }) {
  const [tipo, setTipo] = useState<TipoFeedback>('sugestao');
  const [mensagem, setMensagem] = useState('');
  const [contato, setContato] = useState('');
  const [website, setWebsite] = useState(''); // campo-isca
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  // Página de onde a pessoa veio (só o caminho): ajuda a equipe a achar o problema.
  const [origem, setOrigem] = useState<string | undefined>(paginaOrigem);
  useEffect(() => {
    if (origem) return;
    try {
      const anterior = document.referrer ? new URL(document.referrer) : null;
      if (anterior && anterior.origin === window.location.origin && anterior.pathname !== '/feedback') {
        setOrigem(anterior.pathname);
      }
    } catch {
      /* sem referrer: segue sem origem */
    }
  }, [origem]);

  const onCaptcha = useCallback((token: string | null) => setCaptcha(token), []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const r = await enviarFeedback({ tipo, mensagem, contato, pagina: origem, website }, captcha);
      if (r.ok) setEnviado(true);
      else setErro(r.error);
    } catch {
      setErro('Não foi possível enviar agora. Tente de novo em instantes.');
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div role="status" className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
        <CheckCircle className="mx-auto mb-3 h-10 w-10 text-green-600" />
        <h2 className="text-lg font-bold text-gray-900">Mensagem enviada. Obrigado!</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">
          Ela chega direto para a equipe do Portal Conecta. Se você deixou um e-mail, podemos responder por lá.
        </p>
        <Link href="/" className="mt-5 inline-block text-sm font-semibold text-azul-eletrico hover:underline">
          Voltar ao início
        </Link>
      </div>
    );
  }

  const restante = MENSAGEM_MAX - mensagem.length;

  return (
    <form onSubmit={enviar} className="space-y-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm md:p-8">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-gray-900">Sobre o que você quer falar?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TIPOS_FEEDBACK.map((t) => (
            <label
              key={t.valor}
              className={`flex cursor-pointer flex-col rounded-xl border px-4 py-3 text-sm transition-colors ${
                tipo === t.valor ? 'border-azul-eletrico bg-azul-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="flex items-center gap-2 font-semibold text-gray-900">
                <input
                  type="radio"
                  name="tipo"
                  value={t.valor}
                  checked={tipo === t.valor}
                  onChange={() => setTipo(t.valor)}
                  className="h-4 w-4"
                />
                {t.rotulo}
              </span>
              <span className="ml-6 text-xs text-gray-500">{t.ajuda}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="feedback-mensagem" className="mb-1 block text-sm font-semibold text-gray-900">
          Sua mensagem
        </label>
        <textarea
          id="feedback-mensagem"
          value={mensagem}
          onChange={(e) => setMensagem(e.target.value)}
          rows={6}
          maxLength={MENSAGEM_MAX}
          required
          minLength={MENSAGEM_MIN}
          placeholder="Conte o que aconteceu ou o que você gostaria de ver no portal. Se for um problema, diga em qual página e o que você esperava."
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 focus:border-azul-eletrico focus:outline-none focus:ring-2 focus:ring-azul-eletrico/20"
        />
        <p className={`mt-1 text-right text-xs ${restante < 100 ? 'text-orange-600' : 'text-gray-400'}`}>
          {restante} caracteres restantes
        </p>
      </div>

      <div>
        <label htmlFor="feedback-contato" className="mb-1 block text-sm font-semibold text-gray-900">
          Seu e-mail <span className="font-normal text-gray-500">(opcional, para podermos responder)</span>
        </label>
        <input
          id="feedback-contato"
          type="email"
          value={contato}
          onChange={(e) => setContato(e.target.value)}
          maxLength={CONTATO_MAX}
          autoComplete="email"
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 focus:border-azul-eletrico focus:outline-none focus:ring-2 focus:ring-azul-eletrico/20"
        />
      </div>

      {/* Campo-isca: pessoas não veem nem alcançam pelo teclado; robôs preenchem. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="feedback-website">Não preencha este campo</label>
        <input
          id="feedback-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <TurnstileWidget onVerify={onCaptcha} />

      {erro && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {erro}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-sm text-xs text-gray-500">
          Não envie senhas nem dados pessoais sensíveis. A mensagem é lida pela equipe do portal.
        </p>
        <button
          type="submit"
          disabled={enviando}
          className="inline-flex items-center gap-2 rounded-xl bg-azul-eletrico px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {enviando ? 'Enviando...' : 'Enviar mensagem'}
        </button>
      </div>
    </form>
  );
}
