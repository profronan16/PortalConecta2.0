'use client';

import React, { useRef, useState } from 'react';
import { AlertCircle, FileCode2, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { formatarMb } from '@/lib/post-midias';
import {
  EXTENSOES_DOCUMENTO_HTML,
  LIMITE_DOCUMENTO_HTML_BYTES,
  ehArquivoHtml,
  mensagemDocumentoGrande,
  tituloDoDocumentoHtml,
  validarDocumentoHtml,
} from '@/lib/post-documento-html';
import { DocumentoHtmlDoPost } from '@/components/ui/DocumentoHtmlDoPost';

export type DocumentoHtmlNoFormulario = {
  html: string;
  nome: string | null;
  bytes: number;
  /** `true` quando o arquivo foi escolhido agora (precisa ir para o servidor). */
  alterado: boolean;
};

/**
 * Escolha do arquivo .html de um post + pré-visualização de como ele vai
 * aparecer no portal.
 *
 * O arquivo é lido no navegador e vai junto com o post ao salvar (não passa
 * pelo upload de `/files`: um HTML servido pelo domínio do portal rodaria
 * scripts com a origem do portal). As checagens daqui só avisam mais cedo —
 * quem decide é `validarDocumentoHtml` no servidor.
 */
export function DocumentoHtmlUploader({
  documento,
  onChange,
  onTituloSugerido,
}: {
  documento: DocumentoHtmlNoFormulario | null;
  onChange: (documento: DocumentoHtmlNoFormulario | null) => void;
  /** Chamado com o `<title>` do arquivo, para preencher o título se estiver vazio. */
  onTituloSugerido?: (titulo: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aoEscolher(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);

    if (!ehArquivoHtml(arquivo.name)) {
      setErro('Escolha um arquivo .html ou .htm.');
      return;
    }
    if (arquivo.size > LIMITE_DOCUMENTO_HTML_BYTES) {
      setErro(mensagemDocumentoGrande(arquivo.size));
      return;
    }

    setLendo(true);
    try {
      const html = await arquivo.text();
      const validado = validarDocumentoHtml({ html, nome: arquivo.name });
      if (!validado.ok) {
        setErro(validado.error);
        return;
      }
      onChange({ html, nome: arquivo.name, bytes: arquivo.size, alterado: true });
      const titulo = tituloDoDocumentoHtml(html);
      if (titulo) onTituloSugerido?.(titulo);
    } catch {
      setErro('Não conseguimos ler este arquivo. Tente de novo ou escolha outro.');
    } finally {
      setLendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={[...EXTENSOES_DOCUMENTO_HTML, 'text/html'].join(',')}
        className="hidden"
        onChange={(e) => void aoEscolher(e.target.files?.[0])}
      />

      {documento ? (
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-200">
          <span className="w-9 h-9 rounded-lg bg-azul-eletrico/10 text-azul-eletrico flex items-center justify-center flex-shrink-0">
            <FileCode2 className="w-4 h-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-gray-900 truncate">{documento.nome ?? 'Documento HTML'}</span>
            <span className="block text-xs text-gray-400">{formatarMb(documento.bytes)}</span>
          </span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-azul-eletrico transition-colors"
            title="Trocar arquivo"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
            title="Remover arquivo"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={lendo}
          className="w-full flex flex-col items-center justify-center gap-1 px-4 py-6 rounded-xl border-2 border-dashed border-gray-200 text-gray-500 hover:border-azul-eletrico hover:text-azul-eletrico transition-colors disabled:opacity-50"
        >
          {lendo ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
          <span className="text-sm font-medium">{lendo ? 'Lendo arquivo...' : 'Escolher arquivo .html'}</span>
          <span className="text-xs text-gray-400">Até {formatarMb(LIMITE_DOCUMENTO_HTML_BYTES, 0)}. Cores, fontes e imagens do arquivo são mantidas.</span>
        </button>
      )}

      {erro && (
        <p className="flex items-start gap-1.5 text-xs text-red-600">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          {erro}
        </p>
      )}

      {documento && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Pré-visualização</p>
          <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
            <DocumentoHtmlDoPost html={documento.html} titulo={documento.nome ?? 'Documento HTML'} alturaMaxima={420} />
          </div>
        </div>
      )}
    </div>
  );
}
