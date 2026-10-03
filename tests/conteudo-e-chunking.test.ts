import { describe, it, expect } from 'vitest';
import { sanitizeHtml, toSafeHtml, stripHtml } from '@/lib/rich-text';
import { chunkDocument } from '@/lib/chunking';

/**
 * Segurança de conteúdo (XSS) e camada de chunking do RAG (ROADMAP 4.8).
 *
 * Por que estes dois juntos: o texto que entra na pipeline RAG vem de fontes
 * "confiáveis mas não totalmente" (SUAP, editor rico, upload de PDF) e o mesmo
 * conteúdo é renderizado no site. Sanitização e chunking são as duas fronteiras
 * onde um dado ruim viraria problema — script executado na página ou citação
 * inventada a partir de um chunk mal cortado.
 */

describe('sanitizeHtml — defesa contra XSS', () => {
  it('remove <script> e seu conteúdo', () => {
    const saida = sanitizeHtml('<p>Olá</p><script>alert(1)</script>');

    expect(saida).toContain('Olá');
    expect(saida).not.toContain('script');
    expect(saida).not.toContain('alert');
  });

  it('remove handlers inline (onerror/onclick)', () => {
    const saida = sanitizeHtml('<img src=x onerror="alert(1)">');

    expect(saida).not.toContain('onerror');
    expect(saida).not.toContain('alert');
  });

  it('neutraliza javascript: em links', () => {
    const saida = sanitizeHtml('<a href="javascript:alert(1)">clique</a>');

    expect(saida).not.toContain('javascript:');
  });

  it('remove iframe/object/embed, que não estão na whitelist', () => {
    const saida = sanitizeHtml('<iframe src="https://malicioso.example"></iframe>');

    expect(saida).not.toContain('iframe');
    expect(saida).not.toContain('malicioso.example');
  });

  it('preserva a formatação permitida do editor', () => {
    const saida = sanitizeHtml('<h2>Título</h2><p><strong>negrito</strong> e <em>itálico</em></p><ul><li>item</li></ul>');

    expect(saida).toContain('<h2>');
    expect(saida).toContain('<strong>');
    expect(saida).toContain('<em>');
    expect(saida).toContain('<li>');
  });

  it('mantém apenas os atributos previstos para link e imagem', () => {
    const saida = sanitizeHtml('<a href="https://ifpr.edu.br" onclick="x()" style="color:red">site</a>');

    expect(saida).toContain('href="https://ifpr.edu.br"');
    expect(saida).not.toContain('onclick');
    expect(saida).not.toContain('style=');
  });
});

describe('toSafeHtml — texto puro vs HTML do SUAP', () => {
  it('transforma texto puro em parágrafos, escapando o conteúdo', () => {
    const saida = toSafeHtml('Primeira linha\n\nSegunda linha');

    expect(saida).toBe('<p>Primeira linha</p><p>Segunda linha</p>');
  });

  it('escapa caracteres soltos que não formam tag (não viram markup)', () => {
    const saida = toSafeHtml('se 2 < 3 & 4 > 1 então ok');

    expect(saida).toContain('&lt;');
    expect(saida).toContain('&gt;');
    expect(saida).toContain('&amp;');
  });

  it('quando o texto contém tag fora da whitelist, a tag é removida e o conteúdo fica', () => {
    // O campo pode vir com HTML (SUAP) — nesse caso o conteúdo passa pelo
    // sanitizador, que descarta tags não permitidas (como <b> e <i>) em vez de
    // exibi-las literalmente.
    const saida = toSafeHtml('use <b>assim</b> & <i>assado</i>');

    expect(saida).toContain('assim');
    expect(saida).toContain('assado');
    expect(saida).not.toContain('<b>');
    expect(saida).not.toContain('<i>');
  });

  it('quebra linha simples em <br>', () => {
    expect(toSafeHtml('linha 1\nlinha 2')).toBe('<p>linha 1<br>linha 2</p>');
  });

  it('sanitiza quando o campo já vem com HTML (caso do sync do SUAP)', () => {
    const saida = toSafeHtml('<p>Projeto</p><script>alert(1)</script>');

    expect(saida).toContain('<p>Projeto</p>');
    expect(saida).not.toContain('script');
  });

  it('devolve string vazia para nulo/vazio', () => {
    expect(toSafeHtml(null)).toBe('');
    expect(toSafeHtml(undefined)).toBe('');
    expect(toSafeHtml('   ')).toBe('');
  });
});

describe('stripHtml', () => {
  it('remove tags e colapsa espaços', () => {
    expect(stripHtml('<p>Olá <strong>mundo</strong></p>\n\n<p>de novo</p>')).toBe('Olá mundo de novo');
  });

  it('remove conteúdo de script em vez de vazar código no texto', () => {
    expect(stripHtml('Antes<script>alert(1)</script>Depois')).not.toContain('alert');
  });

  it('texto puro continua texto puro', () => {
    expect(stripHtml('sem tags aqui')).toBe('sem tags aqui');
  });
});

describe('chunkDocument — camada determinística do RAG', () => {
  it('devolve lista vazia para texto vazio', () => {
    expect(chunkDocument('')).toEqual([]);
    expect(chunkDocument('   \n\n  ')).toEqual([]);
  });

  it('mantém texto curto em um único chunk', () => {
    const chunks = chunkDocument('Um parágrafo curto sobre o projeto.');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].texto).toBe('Um parágrafo curto sobre o projeto.');
  });

  it('não perde conteúdo: todo o texto de entrada aparece nos chunks', () => {
    const texto = ['Parágrafo um com algumas palavras.', 'Parágrafo dois, também curto.', 'Parágrafo três.'].join('\n\n');
    const chunks = chunkDocument(texto);

    expect(chunks.map((c) => c.texto).join(' ')).toContain('Parágrafo três');
    expect(chunks.map((c) => c.texto).join(' ')).toContain('Parágrafo um');
  });

  it('anexa a seção detectada ao chunk (metadado usado na citação)', () => {
    const texto = ['ARTIGO 1 DO OBJETO', '', 'Este edital trata de bolsas de extensão.'].join('\n');
    const chunks = chunkDocument(texto);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.secao?.includes('ARTIGO 1'))).toBe(true);
  });

  it('respeita o limite de tokens configurado (aproximação por palavras)', () => {
    const paragrafo = Array.from({ length: 400 }, (_, i) => `palavra${i}`).join(' ');
    const chunks = chunkDocument(paragrafo, { maxTokens: 100, overlapTokens: 0, preserveSections: false });

    expect(chunks.length).toBeGreaterThan(1);
    // ~0.75 palavras por token → 100 tokens ≈ 75 palavras; com folga, nenhum
    // chunk pode chegar perto do texto inteiro.
    for (const chunk of chunks) {
      expect(chunk.texto.split(/\s+/).length).toBeLessThanOrEqual(80);
    }
  });

  it('aplica overlap entre chunks do mesmo parágrafo gigante', () => {
    const palavras = Array.from({ length: 300 }, (_, i) => `w${i}`);
    const chunks = chunkDocument(palavras.join(' '), {
      maxTokens: 100,
      overlapTokens: 50,
      preserveSections: false,
    });

    expect(chunks.length).toBeGreaterThan(1);

    // O fim de um chunk reaparece no começo do próximo (é o que dá contexto
    // contínuo ao retrieval sem cortar frase no meio).
    const fimDoPrimeiro = chunks[0].texto.split(/\s+/).slice(-20).join(' ');
    const inicioDoSegundo = chunks[1].texto.split(/\s+/).slice(0, 40).join(' ');
    expect(inicioDoSegundo).toContain(fimDoPrimeiro);
  });

  it('quebra por seções quando a divisão está ligada', () => {
    const texto = [
      'SEÇÃO UM',
      '',
      'Conteúdo da primeira seção.',
      '',
      'SEÇÃO DOIS',
      '',
      'Conteúdo da segunda seção.',
    ].join('\n');
    const chunks = chunkDocument(texto, { preserveSections: true });

    const secoes = chunks.map((c) => c.secao).filter(Boolean);
    expect(secoes).toContain('SEÇÃO UM');
    expect(secoes).toContain('SEÇÃO DOIS');
  });

  it('nunca devolve chunk vazio', () => {
    const chunks = chunkDocument('a\n\n\n\nb\n\n\n\nc');

    for (const chunk of chunks) {
      expect(chunk.texto.trim().length).toBeGreaterThan(0);
    }
  });
});
