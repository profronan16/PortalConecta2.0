'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MENSAGEM_DOCUMENTO, montarSrcdoc } from '@/lib/post-documento-html';

/** Teto de altura: protege a página de um documento que cresce sem parar. */
const ALTURA_MAXIMA = 60000;

/**
 * Exibe o documento HTML de um post, com o CSS, as imagens e os scripts dele,
 * isolado num iframe sandbox (ver o porquê em src/lib/post-documento-html.ts).
 *
 * Na página pública o iframe cresce até a altura do conteúdo — a página tem uma
 * rolagem só, como se o documento fizesse parte dela. Na pré-visualização do
 * formulário (`alturaMaxima`) ele fica com altura fixa e rola por dentro.
 */
export function DocumentoHtmlDoPost({
  html,
  titulo,
  alturaMaxima,
  className,
}: {
  html: string;
  titulo: string;
  alturaMaxima?: number;
  className?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [altura, setAltura] = useState(600);
  const srcdoc = useMemo(() => montarSrcdoc(html), [html]);

  useEffect(() => {
    if (alturaMaxima) return;

    function aoReceber(evento: MessageEvent) {
      // Só vale mensagem deste iframe (a origem é opaca — "null" —, então a
      // identidade é conferida pela janela de origem).
      if (!ref.current || evento.source !== ref.current.contentWindow) return;
      const dados = evento.data as { tipo?: unknown; altura?: unknown; topo?: unknown } | null;
      if (!dados || typeof dados.tipo !== 'string') return;

      if (dados.tipo === `${MENSAGEM_DOCUMENTO}:altura` && typeof dados.altura === 'number' && Number.isFinite(dados.altura)) {
        setAltura(Math.min(Math.max(Math.ceil(dados.altura), 150), ALTURA_MAXIMA));
      }

      if (dados.tipo === `${MENSAGEM_DOCUMENTO}:ancora` && typeof dados.topo === 'number' && Number.isFinite(dados.topo)) {
        const topoDoQuadro = ref.current.getBoundingClientRect().top + window.scrollY;
        // Desconta o cabeçalho fixo do portal para o título da seção não ficar escondido.
        window.scrollTo({ top: Math.max(topoDoQuadro + dados.topo - 88, 0), behavior: 'smooth' });
      }
    }

    window.addEventListener('message', aoReceber);
    return () => window.removeEventListener('message', aoReceber);
  }, [alturaMaxima]);

  return (
    <iframe
      ref={ref}
      title={titulo}
      srcDoc={srcdoc}
      // SEM `allow-same-origin`: o documento roda numa origem opaca e não
      // alcança cookies, storage nem o DOM do portal. `allow-popups*` deixa os
      // links do documento abrirem normalmente em nova aba.
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      // Na página o quadro já tem a altura do conteúdo: uma barra interna de
      // poucos pixels (arredondamento, margem do último bloco) só atrapalharia.
      // Na pré-visualização a rolagem interna é o comportamento esperado.
      scrolling={alturaMaxima ? undefined : 'no'}
      className={className}
      style={{ width: '100%', border: 0, display: 'block', height: alturaMaxima ?? altura }}
    />
  );
}
