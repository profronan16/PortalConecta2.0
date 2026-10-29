import { describe, it, expect } from 'vitest';
import {
  LIMITE_DOCUMENTO_HTML_BYTES,
  conteudoTextualDoDocumento,
  limparDocumentoHtml,
  montarSrcdoc,
  tituloDoDocumentoHtml,
  validarDocumentoHtml,
} from '@/lib/post-documento-html';
import { LIMITES } from '@/lib/validacao';

/**
 * Post feito de arquivo HTML (manual da marca, material com CSS próprio).
 *
 * O que estes testes travam:
 *  - o documento chega ao iframe com a CSP e o script-ponte ANTES de tudo
 *    (CSP só vale para o que vem depois dela);
 *  - fragmento sem `<!doctype>` ganha um (senão o layout sai em quirks mode);
 *  - `<base>`, `<meta http-equiv>` e conteúdo embutido de terceiros saem;
 *  - o texto do post (busca, resumo) sai do documento, sem CSS nem script;
 *  - o servidor recusa arquivo grande demais, vazio ou com extensão errada.
 */

const FRAGMENTO = `<title>Manual da Marca</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2">
<style>.hero{color:#2f9e41}</style>
<header class="hero" id="topo"><h1>Manual da marca</h1><p>Use o verde &amp; o vermelho.</p></header>
<script>document.querySelector('h1').dataset.ok = '1';</script>
<section><h2>Cores</h2><p>Verde IF</p></section>`;

describe('montarSrcdoc', () => {
  it('fragmento sem <html>: ganha doctype e a CSP vem antes do conteúdo', () => {
    const doc = montarSrcdoc(FRAGMENTO);
    expect(doc.startsWith('<!doctype html><head>')).toBe(true);
    const csp = doc.indexOf('Content-Security-Policy');
    expect(csp).toBeGreaterThan(-1);
    expect(csp).toBeLessThan(doc.indexOf('<title>'));
    expect(csp).toBeLessThan(doc.indexOf('<script>document'));
  });

  it('documento completo: injeta logo depois de <head> e mantém o doctype original', () => {
    const doc = montarSrcdoc('<!DOCTYPE html><html lang="pt-BR"><head><title>X</title></head><body><p>oi</p></body></html>');
    expect(doc.startsWith('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">')).toBe(true);
    expect(doc.match(/<!doctype/gi)).toHaveLength(1);
  });

  it('documento com <html> mas sem <head>: cria o <head> com a injeção', () => {
    const doc = montarSrcdoc('<html><body><p>oi</p></body></html>');
    expect(doc).toContain('<html><head><meta charset="utf-8">');
  });

  it('a CSP fecha rede, formulários e frames', () => {
    const doc = montarSrcdoc('<p>oi</p>');
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("form-action 'none'");
    expect(doc).toContain("frame-src 'none'");
    // Script externo não carrega — só os inline do próprio documento.
    expect(doc).toContain("script-src 'unsafe-inline'");
    expect(doc).not.toMatch(/script-src[^;]*https:/);
  });
});

describe('limparDocumentoHtml', () => {
  it('tira <base>, <meta http-equiv> e conteúdo embutido de terceiros', () => {
    const limpo = limparDocumentoHtml(
      '<base href="https://x.com/"><meta http-equiv="refresh" content="0;url=https://x.com">' +
      '<iframe src="https://x.com"></iframe><object data="a.swf"></object><embed src="b.swf"><p>fica</p>',
    );
    expect(limpo).toBe('<p>fica</p>');
  });

  it('mantém estilos, imagens embutidas e scripts inline', () => {
    const html = '<style>p{color:red}</style><img src="data:image/png;base64,AAAA"><script>1</script>';
    expect(limparDocumentoHtml(html)).toBe(html);
  });
});

describe('texto do documento', () => {
  it('título vem do <title>', () => {
    expect(tituloDoDocumentoHtml(FRAGMENTO)).toBe('Manual da Marca');
    expect(tituloDoDocumentoHtml('<p>sem título</p>')).toBeNull();
  });

  it('conteúdo: parágrafos de texto, sem CSS, script nem título', () => {
    const conteudo = conteudoTextualDoDocumento(FRAGMENTO);
    expect(conteudo).toContain('<p>Manual da marca</p>');
    expect(conteudo).toContain('Use o verde &amp; o vermelho.');
    expect(conteudo).toContain('<p>Cores</p>');
    expect(conteudo).not.toContain('color:#2f9e41');
    expect(conteudo).not.toContain('querySelector');
    expect(conteudo).not.toContain('<p>Manual da Marca</p>'); // o <title>
  });

  it('conteúdo respeita o teto de Post.conteudo', () => {
    const grande = Array.from({ length: 3000 }, (_, i) => `<p>Parágrafo número ${i} do documento.</p>`).join('');
    expect(conteudoTextualDoDocumento(grande).length).toBeLessThanOrEqual(LIMITES.html.max);
  });
});

describe('validarDocumentoHtml', () => {
  it('aceita um documento normal e devolve o texto para o post', () => {
    const r = validarDocumentoHtml({ html: FRAGMENTO, nome: 'manual.html' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.nomeArquivo).toBe('manual.html');
      expect(r.valor.conteudo).toContain('Cores');
      expect(r.valor.bytes).toBeGreaterThan(0);
    }
  });

  it('recusa vazio, sem texto, extensão errada e arquivo grande', () => {
    expect(validarDocumentoHtml({ html: '   ' }).ok).toBe(false);
    expect(validarDocumentoHtml({ html: 123 }).ok).toBe(false);
    expect(validarDocumentoHtml({ html: '<script src="https://x.com/a.js"></script>' }).ok).toBe(false);
    expect(validarDocumentoHtml({ html: '<p>oi</p>', nome: 'virus.exe' }).ok).toBe(false);
    const enorme = '<p>' + 'a'.repeat(LIMITE_DOCUMENTO_HTML_BYTES) + '</p>';
    expect(validarDocumentoHtml({ html: enorme, nome: 'grande.html' }).ok).toBe(false);
  });
});
