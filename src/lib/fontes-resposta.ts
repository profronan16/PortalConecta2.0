/**
 * ==============================================================================
 * FONTES DAS RESPOSTAS DA IFIZINHA
 * ==============================================================================
 *
 * Toda resposta do chat precisa deixar rastreável de onde a informação veio —
 * é o que permite a pessoa conferir no site oficial antes de tomar qualquer
 * decisão (prazo de edital, valor de auxílio, mudança de calendário).
 *
 * O desenho é o de "IA com citações" (Perplexity, ChatGPT search):
 *
 *   1. o contexto enviado ao modelo numera cada fonte — `[fonte 1]`, `[fonte 2]`;
 *   2. o modelo cita o NÚMERO no meio do texto;
 *   3. a interface renderiza, abaixo da resposta, a lista de fontes com o link.
 *
 * A lista é montada aqui, no servidor, a partir dos chunks que a busca REALMENTE
 * devolveu — não do que o modelo disse ter usado. Ou seja: mesmo que o modelo
 * esqueça de citar, o link da origem continua aparecendo. Isso é proposital:
 * instrução de prompt é sugestão; lista montada por código é garantia.
 */

import type { ChunkSearchResult } from '@/lib/busca-vetorial';

export type TipoFonte = 'documento' | 'projeto' | 'edital' | 'agenda';

export interface FonteResposta {
  /** Número que aparece no texto da resposta (`[1]`, `[2]`...). */
  numero: number;
  titulo: string;
  /** Link para conferir a informação na origem. Pode faltar em dados antigos. */
  url: string | null;
  /** Categoria legível: "Edital", "Curso", "Institucional", "Projeto"... */
  categoria: string;
  tipo: TipoFonte;
  /** Trecho que fundamentou a resposta (para dar contexto ao link). */
  trecho: string | null;
  /** Data de publicação/atualização da origem, quando conhecida. */
  data: string | null;
  /** Id do documento na base (permite ligar cada trecho do contexto à fonte). */
  documentoId?: string;
}

const LIMITE_DE_FONTES = 6;

const ROTULO_CATEGORIA: Record<string, string> = {
  edital: 'Edital',
  curso: 'Curso',
  ppc: 'Projeto Pedagógico de Curso',
  institucional: 'Institucional',
  norma: 'Norma',
  regulamento: 'Regulamento',
  secretaria: 'Secretaria Acadêmica',
  ensino: 'Ensino',
  estagio: 'Estágio',
  extensao: 'Extensão',
  extens: 'Extensão',
  pesquisa: 'Pesquisa',
  concurso: 'Concurso',
  diepex: 'DIEPEX',
  assistencia: 'Assistência Estudantil',
  indice: 'Índice de conteúdos',
};

export function rotuloCategoria(categoria: string | null | undefined): string {
  if (!categoria) return 'Documento';
  return ROTULO_CATEGORIA[categoria] ?? categoria.charAt(0).toUpperCase() + categoria.slice(1);
}

/** Corta o trecho em um limite de palavra, sem cortar no meio da frase. */
function resumirTrecho(texto: string, limite = 180): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  if (limpo.length <= limite) return limpo;
  const corte = limpo.slice(0, limite);
  const ultimoEspaco = corte.lastIndexOf(' ');
  return `${(ultimoEspaco > 80 ? corte.slice(0, ultimoEspaco) : corte).trim()}…`;
}

/**
 * Deduplica os chunks por documento e devolve as fontes numeradas.
 *
 * Vários chunks do mesmo documento costumam aparecer juntos (é o esperado:
 * o edital inteiro fala do mesmo assunto). Mostrar 5 links para o mesmo
 * documento polui a resposta, então vale o de maior similaridade.
 */
export function montarFontesDeChunks(
  chunks: ChunkSearchResult[],
  urlPorDocumento: Map<string, string | null> = new Map(),
  /** Número da primeira fonte (para continuar a lista de outro bloco). */
  inicio = 1
): FonteResposta[] {
  const porDocumento = new Map<string, ChunkSearchResult>();

  for (const chunk of chunks) {
    const atual = porDocumento.get(chunk.documento_id);
    if (!atual || chunk.similarity > atual.similarity) {
      porDocumento.set(chunk.documento_id, chunk);
    }
  }

  return [...porDocumento.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .map((chunk) => {
      const metadata = (chunk.metadata ?? {}) as Record<string, unknown>;
      const data =
        typeof metadata.ultima_atualizacao === 'string'
          ? metadata.ultima_atualizacao
          : typeof metadata.data_publicacao === 'string'
            ? metadata.data_publicacao
            : null;

      return {
        numero: 0,
        titulo: chunk.documento_titulo,
        url: urlPorDocumento.get(chunk.documento_id) ?? chunk.documento_url ?? null,
        categoria: rotuloCategoria(chunk.categoria),
        tipo: 'documento' as const,
        trecho: resumirTrecho(chunk.texto),
        data,
        documentoId: chunk.documento_id,
      };
    })
    // Fonte sem link não deixa a pessoa conferir nada — e "mostre a fonte" só
    // vale se der para abrir a origem. Documento antigo sem URL (base gerada a
    // partir de projetos, por exemplo) fica de fora da lista.
    .filter((fonte) => !!fonte.url)
    .slice(0, LIMITE_DE_FONTES)
    .map((fonte, indice) => ({ ...fonte, numero: inicio + indice }));
}

/** Fontes de projeto/edital cadastrados no portal (têm página própria). */
export function montarFontesDeRegistros(
  inicio: number,
  projetos: Array<{ nome: string; slug: string | null; area?: string | null }> = [],
  editais: Array<{ titulo: string; slug: string | null; categoria?: string | null }> = []
): FonteResposta[] {
  const fontes: FonteResposta[] = [];
  let numero = inicio;

  for (const projeto of projetos) {
    fontes.push({
      numero: numero++,
      titulo: projeto.nome,
      url: projeto.slug ? `/projetos/${projeto.slug}` : null,
      categoria: projeto.area || 'Projeto',
      tipo: 'projeto',
      trecho: null,
      data: null,
    });
  }

  for (const edital of editais) {
    fontes.push({
      numero: numero++,
      titulo: edital.titulo,
      url: edital.slug ? `/editais/${edital.slug}` : null,
      categoria: rotuloCategoria(edital.categoria),
      tipo: 'edital',
      trecho: null,
      data: null,
    });
  }

  return fontes;
}

/** Texto humanizado do link, para exibir ao lado do título. */
export function rotuloDoLink(url: string | null): string {
  if (!url) return '';
  try {
    const absoluta = new URL(url, 'https://portal.ifcoding.com.br');
    return absoluta.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Deixa apenas as fontes que o modelo REALMENTE citou no texto.
 *
 * Sem isso a resposta vinha com 13 links: 6 documentos + 4 projetos + 3 editais
 * que entram no contexto por padrão. Como o modelo só cita os números que usou,
 * filtrar pelos números citados devolve a lista enxuta — e o que sobra é
 * exatamente o que a pessoa precisa conferir.
 *
 * Se o modelo não citou nada (acontece), mantém as fontes de documento mais
 * bem colocadas: é melhor mostrar o link da origem usada do que nenhum.
 */
export function filtrarFontesCitadas(reply: string, fontes: FonteResposta[]): FonteResposta[] {
  const citados = new Set<number>();
  for (const achado of reply.matchAll(/\[(\d{1,2})\]/g)) {
    citados.add(Number(achado[1]));
  }

  const usadas = fontes.filter((fonte) => citados.has(fonte.numero));

  if (usadas.length > 0) return usadas;

  // Nada citado: mantém as primeiras fontes com link. Elas são, por construção,
  // as mais relevantes para a pergunta (documentos do RAG vêm antes).
  return fontes.filter((fonte) => !!fonte.url).slice(0, 3);
}
