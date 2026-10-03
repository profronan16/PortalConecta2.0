/**
 * Chunking determinístico (baseado em regras, sem LLM) — camada Curador da
 * pipeline RAG. Prioridade de separação: seções/títulos detectados > parágrafos
 * > limite de tokens (com overlap). A IA entra depois (Etapa 3) para enriquecer
 * metadados, não para decidir onde cortar.
 */

export interface ChunkingConfig {
  maxTokens: number;
  overlapTokens: number;
  preserveSections: boolean;
}

export interface StructuredChunk {
  texto: string;
  secao: string | null;
}

const DEFAULT_CONFIG: ChunkingConfig = {
  maxTokens: 700,
  overlapTokens: 100,
  preserveSections: true,
};

// Aproximação sem tokenizer real (nenhuma lib de tokenização está instalada) —
// ~0.75 palavras por token é uma estimativa razoável para português.
const WORDS_PER_TOKEN = 0.75;

/**
 * Divide o texto em seções, preservando a estrutura de linhas.
 *
 * HISTÓRICO DO BUG (importante, para não regredir):
 * a versão anterior criava uma NOVA SEÇÃO a cada linha "tipo título". Como
 * `detectHeading` casa `^art(igo)?\.?\s*\d+`, a linha
 * "ARTIGO 3. Cada estudante monitor cumpre carga horaria de 12 horas semanais,"
 * era classificada como TÍTULO e **descartada do conteúdo** (virava
 * `secao`), sobrando só o resto do artigo. Medido: o chunk ficava começando em
 * "(oitocentos e setenta e tres reais)..." e a frase "12 horas semanais"
 * desaparecia do conteúdo — a pergunta do usuário deixava de recuperá-la.
 *
 * Agora cada linha é um PARÁGRAFO (linhas separadas por linha em branco), então
 * `chunkDocument` agrupa e corta respeitando limites de frase/artigo, em vez de
 * fatiar por contagem de palavras no meio do texto.
 */
function splitIntoSections(text: string): Array<{ titulo: string | null; conteudo: string }> {
  const linhas = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Título de seção de verdade: só quando a linha é CURTA e o `secao` tem
  // valor semântico (cabeçalho markdown ou linha curta em maiúsculas). A linha
  // "ARTIGO N. <texto>" continua sendo conteúdo, porque é longa.
  const linhasConteudo: string[] = [];
  const secoes: Array<{ titulo: string | null; conteudo: string }> = [];
  let tituloAtual: string | null = null;

  for (const linha of linhas) {
    const ehTituloMarkdown = /^#{1,6}\s/.test(linha);
    const ehTituloCurto =
      linha.length <= 80 &&
      !/[.,;:]$/.test(linha) &&
      linha === linha.toUpperCase() &&
      linha.split(/\s+/).length <= 10;

    if (ehTituloMarkdown || ehTituloCurto) {
      // Fecha a seção anterior antes de começar outra
      if (linhasConteudo.length > 0) {
        secoes.push({ titulo: tituloAtual, conteudo: linhasConteudo.join('\n\n') });
        linhasConteudo.length = 0;
      }
      tituloAtual = linha.replace(/^#{1,6}\s*/, '').trim();
      continue;
    }

    linhasConteudo.push(linha);
  }

  if (linhasConteudo.length > 0) {
    secoes.push({ titulo: tituloAtual, conteudo: linhasConteudo.join('\n\n') });
  }

  return secoes.filter((s) => s.conteudo.trim().length > 0);
}

export function chunkDocument(text: string, config: Partial<ChunkingConfig> = {}): StructuredChunk[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const maxWords = Math.max(50, Math.round(cfg.maxTokens * WORDS_PER_TOKEN));
  const overlapWords = Math.max(0, Math.round(cfg.overlapTokens * WORDS_PER_TOKEN));

  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned) return [];

  const sections = cfg.preserveSections ? splitIntoSections(cleaned) : [{ titulo: null, conteudo: cleaned }];
  const chunks: StructuredChunk[] = [];

  for (const section of sections) {
    const paragraphs = section.conteudo.split(/\n\s*\n/).filter((p) => p.trim());
    let current: string[] = [];
    let currentWords = 0;

    const flush = () => {
      if (current.length === 0) return;
      chunks.push({ texto: current.join('\n\n').trim(), secao: section.titulo });
      current = [];
      currentWords = 0;
    };

    for (const para of paragraphs) {
      const paraWords = para.split(/\s+/).filter(Boolean).length;
      const ehInicioDeArtigo = /^(art(igo)?\.?\s*\d+|cap[ií]tulo\s+\w+|se[cç][aã]o\s+\w+)/i.test(para.trim());

      // Um novo ARTIGO/CAPÍTULO começa um chunk novo, MESMO que ainda caiba no
      // atual. Sem isso, vários artigos se fundem numa "bola" só: o embedding
      // fica diluído entre vários assuntos e o modelo erra detalhes.
      //
      // Medido: um regulamento com 6 artigos virava 1 chunk. Perguntar "quantas
      // horas semanais?" fazia o chat responder que "o documento não traz um
      // número fixo" — mesmo com o Artigo 3 dizendo "12 horas semanais" no
      // mesmo chunk. Com um chunk por artigo, cada embedding tem um assunto só.
      if (ehInicioDeArtigo && current.length > 0) {
        flush();
      }

      if (paraWords > maxWords) {
        // Parágrafo sozinho já estoura o limite — quebra por palavras com overlap
        flush();
        const words = para.split(/\s+/).filter(Boolean);
        const step = Math.max(1, maxWords - overlapWords);
        for (let i = 0; i < words.length; i += step) {
          chunks.push({ texto: words.slice(i, i + maxWords).join(' '), secao: section.titulo });
        }
        continue;
      }

      if (currentWords + paraWords > maxWords && current.length > 0) {
        flush();
        if (overlapWords > 0 && chunks.length > 0) {
          const prevWords = chunks[chunks.length - 1].texto.split(/\s+/);
          const tail = prevWords.slice(-overlapWords).join(' ');
          if (tail) {
            current.push(tail);
            currentWords += Math.min(overlapWords, prevWords.length);
          }
        }
      }

      current.push(para);
      currentWords += paraWords;
    }

    flush();
  }

  return chunks.length > 0 ? chunks : [{ texto: cleaned, secao: null }];
}
