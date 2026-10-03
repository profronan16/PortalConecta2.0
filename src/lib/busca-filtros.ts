/**
 * Regras puras da busca global (ROADMAP 6.6).
 *
 * Este arquivo NÃO importa `@/lib/prisma` de propósito: as mesmas regras são
 * consumidas pelo Server Component `/busca` e podem ser reaproveitadas por
 * qualquer componente client (ex.: o campo de busca do Header, que outra pessoa
 * vai ligar). Importar o Prisma aqui arrastaria o client do banco para o bundle
 * do navegador. As consultas vivem em `@/lib/busca`.
 */

/** Rota única da busca global — evita string mágica espalhada na UI. */
export const BUSCA_HREF = '/busca';

/**
 * Termo maior que isto não é busca, é payload: cortamos em 80 caracteres
 * (mesma ordem de grandeza do `slice(0, 100)` de `/projetos`) porque o termo
 * vai direto para um `contains` em três tabelas diferentes.
 */
export const BUSCA_MAX_TERMO = 80;

/**
 * Com 1 caractere o `contains` casa com quase o banco inteiro e a página fica
 * inútil (qualquer projeto com "a" no nome). Abaixo disso orientamos o usuário
 * em vez de ir ao banco.
 */
export const BUSCA_MIN_TERMO = 2;

/**
 * Quantos itens por categoria a página lista. O total real de cada categoria
 * vem de um `count` separado, então "mostrando 5 de 37" continua correto sem
 * trazer 37 linhas para a tela.
 */
export const BUSCA_LIMITE_POR_TIPO = 5;

/** Tipos de entidade pesquisáveis — nesta ordem na página. */
export const TIPOS_BUSCA = ['projeto', 'edital', 'post'] as const;

export type TipoBusca = (typeof TIPOS_BUSCA)[number];

/**
 * Rótulos e âncoras por tipo. Ficam aqui (e não na página) porque a mesma
 * informação é usada para montar link (`ancoraDoTipo`) e para o texto da UI —
 * duas fontes de verdade divergiriam no primeiro rename.
 */
export const TIPO_BUSCA_INFO: Record<
  TipoBusca,
  { singular: string; plural: string; descricao: string; ancora: string }
> = {
  projeto: {
    singular: 'Projeto',
    plural: 'Projetos',
    descricao: 'nome, descrição, coordenação e área',
    ancora: 'projetos',
  },
  edital: {
    singular: 'Edital',
    plural: 'Editais',
    descricao: 'título, número e resumo',
    ancora: 'editais',
  },
  post: {
    singular: 'Publicação',
    plural: 'Publicações',
    descricao: 'título, resumo e conteúdo',
    ancora: 'publicacoes',
  },
};

/** `id` da seção de um tipo dentro de `/busca` (deep link para a seção). */
export function ancoraDoTipo(tipo: TipoBusca): string {
  return TIPO_BUSCA_INFO[tipo].ancora;
}

export type BuscaSearchParams = {
  q?: string | string[];
};

export type BuscaParams = {
  /** Termo já normalizado (pronto para ir ao banco/href). */
  q: string;
  /** O termo passa das regras mínimas? Se não, a página não consulta. */
  valido: boolean;
};

function primeiro(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

/**
 * Normaliza o termo digitado: colapsa espaços internos (o `contains` do
 * Postgres não casa "horta  urbana" com "horta urbana"), remove os das pontas
 * e limita o tamanho.
 *
 * NÃO removemos acentos aqui de propósito: o banco guarda "Extensão",
 * "Ivaiporã", etc., e `mode: 'insensitive'` no Postgres cobre apenas caixa —
 * mandar "extensao" para a query devolveria zero resultados (a extensão
 * `unaccent` não é garantida no banco, mesmo motivo documentado em
 * `projetos-filtros.ts`). A comparação sem acento existe só para ordenar por
 * relevância (`contemTermo`), onde normalizamos os DOIS lados igualmente.
 */
export function normalizarTermoBusca(valor: string | string[] | undefined): string {
  return primeiro(valor).replace(/\s+/g, ' ').trim().slice(0, BUSCA_MAX_TERMO).trim();
}

/**
 * O termo merece ir ao banco? Vazio, só espaços, 1 caractere ou acima do
 * limite máximo: não.
 */
export function termoBuscaValido(termo: string): boolean {
  const t = termo.trim();
  return t.length >= BUSCA_MIN_TERMO && t.length <= BUSCA_MAX_TERMO;
}

/**
 * Normaliza os searchParams de `/busca` (aceita `?q=` repetido, array, etc.).
 * Função pura — testável sem banco, no mesmo padrão de
 * `normalizarParamsProjetos`.
 */
export function normalizarParamsBusca(input: BuscaSearchParams): BuscaParams {
  const q = normalizarTermoBusca(input?.q);
  return { q, valido: termoBuscaValido(q) };
}

/** Monta o href de `/busca` preservando o termo (sem termo, volta à URL limpa). */
export function buildBuscaHref(params: { q?: string | string[] }): string {
  const termo = normalizarTermoBusca(params?.q);
  const search = new URLSearchParams();
  if (termo) search.set('q', termo);

  const qs = search.toString();
  return qs ? `${BUSCA_HREF}?${qs}` : BUSCA_HREF;
}

/**
 * Minúsculas + sem acentos, para comparar dois textos pela mesma régua (o
 * banco só faz *case-insensitive*, não *accent-insensitive*).
 * `normalize('NFD')` separa a letra do acento e o range U+0300–U+036F remove
 * os diacríticos combinantes.
 */
export function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * O termo aparece em `texto`? Ignora caixa e acentos. Termo vazio devolve
 * `false` de propósito: sem termo não há "casou com tudo", há busca desligada.
 */
export function contemTermo(texto: string | null | undefined, termo: string): boolean {
  const alvo = termo.trim();
  if (!texto || !alvo) return false;
  return semAcento(texto).includes(semAcento(alvo));
}

/** 2 = casou no título; 1 = casou no subtítulo; 0 = casou só no corpo. */
export function relevanciaDoItem(
  item: { titulo: string; subtitulo?: string | null },
  termo: string,
): number {
  if (contemTermo(item.titulo, termo)) return 2;
  if (contemTermo(item.subtitulo, termo)) return 1;
  return 0;
}

/**
 * Ordena por relevância mantendo a ordem original em caso de empate — o
 * `orderBy` do banco vira o desempate, então o resultado continua
 * determinístico entre requisições.
 *
 * Observação: como o banco já traz apenas `limitePorTipo` linhas por categoria,
 * isto reordena o que veio, não o universo inteiro de resultados. Fazer
 * relevância global exigiria `tsvector`/`rank`, fora do escopo do 6.6.
 */
export function ordenarPorRelevancia<T extends { titulo: string; subtitulo?: string | null }>(
  itens: T[],
  termo: string,
): T[] {
  return itens
    .map((item, indice) => ({ item, indice, peso: relevanciaDoItem(item, termo) }))
    .sort((a, b) => b.peso - a.peso || a.indice - b.indice)
    .map(({ item }) => item);
}

/** Limite sempre seguro: valor inválido/zero/negativo cai no padrão. */
export function normalizarLimite(limite: number = BUSCA_LIMITE_POR_TIPO): number {
  return Number.isFinite(limite) && limite > 0 ? Math.floor(limite) : BUSCA_LIMITE_POR_TIPO;
}

/** Aplica o limite por categoria (última barreira antes da renderização). */
export function limitarResultados<T>(itens: T[], limite?: number): T[] {
  return itens.slice(0, normalizarLimite(limite));
}
