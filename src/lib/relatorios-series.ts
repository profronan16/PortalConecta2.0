/**
 * Transformações PURAS dos dados de relatório (ROADMAP 6.7 — "Relatórios
 * avançados com gráficos").
 *
 * POR QUE ESTE ARQUIVO É SEPARADO DE `src/lib/relatorios.ts`: aqui não existe
 * nenhuma consulta ao banco (não importamos `@/lib/prisma`), então tudo pode
 * ser testado em Node puro e reaproveitado tanto no servidor quanto nos
 * componentes client dos gráficos. `src/lib/relatorios.ts` só busca os números
 * agregados; as decisões de percentual, escala, ordenação, arredondamento e
 * preenchimento de meses vazios moram aqui — que é exatamente o que os testes
 * cobrem.
 *
 * REGRA QUE NUNCA PODE REGREDIR: total zero não pode produzir `NaN` nem
 * `Infinity`. Um relatório de projeto recém-criado (nenhuma inscrição) cai
 * nesse caminho o tempo todo.
 */

// ── Tipos compartilhados ─────────────────────────────────────────────────────

/** Par rótulo/valor cru, como vem do `groupBy` do Prisma. */
export type ContagemBruta = { rotulo: string; valor: number };

/** Ponto pronto para o gráfico, já com o percentual sobre o total da série. */
export type PontoSerie = ContagemBruta & { percentual: number };

/** Contagem mensal crua vinda do banco (`periodo` no formato `YYYY-MM`). */
export type ContagemMensal = { periodo: string; total: number };

/** Linha do gráfico de vagas: preenchidas (selecionados) x total ofertado. */
export type SerieVagas = {
  rotulo: string;
  preenchidas: number;
  total: number;
  percentual: number;
};

// ── Rótulos (pt-BR) ──────────────────────────────────────────────────────────

/**
 * Ordem canônica dos status de `Inscricao.status` (string livre no schema, ver
 * prisma/schema.prisma). Manter a ordem fixa — e não a ordem que o banco
 * devolve — é o que faz o gráfico de rosca ter sempre a mesma sequência de
 * cores entre um projeto e outro.
 */
export const STATUS_INSCRICAO = [
  'recebida',
  'em_analise',
  'selecionado',
  'lista_espera',
  'nao_selecionado',
  'desistente',
] as const;

export type StatusInscricao = (typeof STATUS_INSCRICAO)[number];

/**
 * `getStatusLabel` (src/lib/utils.ts) não cobre os status em minúsculo da
 * inscrição, então os rótulos usados nos relatórios ficam aqui — local único,
 * em português, sem depender do módulo de utilidades do cliente.
 */
export const ROTULOS_STATUS_INSCRICAO: Record<StatusInscricao, string> = {
  recebida: 'Recebida',
  em_analise: 'Em análise',
  selecionado: 'Selecionado',
  lista_espera: 'Lista de espera',
  nao_selecionado: 'Não selecionado',
  desistente: 'Desistente',
};

export function ehStatusInscricao(valor: string): valor is StatusInscricao {
  return (STATUS_INSCRICAO as readonly string[]).includes(valor);
}

/** Rótulo legível de um status de inscrição; desconhecido vira o próprio texto sem `_`. */
export function rotuloStatusInscricao(status: string): string {
  if (ehStatusInscricao(status)) return ROTULOS_STATUS_INSCRICAO[status];
  return (status || 'Não informado').replace(/_/g, ' ');
}

/** Ordem canônica das categorias de edital (`CategoriaEdital` no schema). */
export const CATEGORIAS_EDITAL = [
  'BOLSAS',
  'AUXILIOS',
  'EXTENSAO',
  'PESQUISA',
  'ENSINO',
  'EVENTOS',
  'ESTAGIOS',
  'RESULTADOS',
] as const;

export type CategoriaEditalSerie = (typeof CATEGORIAS_EDITAL)[number];

export const ROTULOS_CATEGORIA_EDITAL: Record<CategoriaEditalSerie, string> = {
  BOLSAS: 'Bolsas',
  AUXILIOS: 'Auxílios',
  EXTENSAO: 'Extensão',
  PESQUISA: 'Pesquisa',
  ENSINO: 'Ensino',
  EVENTOS: 'Eventos',
  ESTAGIOS: 'Estágios',
  RESULTADOS: 'Resultados',
};

export function rotuloCategoriaEdital(categoria: string): string {
  if ((CATEGORIAS_EDITAL as readonly string[]).includes(categoria)) {
    return ROTULOS_CATEGORIA_EDITAL[categoria as CategoriaEditalSerie];
  }
  return categoria || 'Não informada';
}

/** Rótulo usado quando `Projeto.area` vem vazio (o campo é `String @default("")`). */
export const AREA_NAO_INFORMADA = 'Não informada';

// ── Números seguros ──────────────────────────────────────────────────────────

/**
 * Converte qualquer entrada (null, undefined, NaN, Infinity, string numérica,
 * bigint do driver) em número finito e não negativo. É a barreira que impede
 * `NaN` de vazar para dentro do SVG (um `NaN` em coordenada derruba o gráfico
 * inteiro, não só a barra).
 */
export function numeroSeguro(valor: unknown, fallback = 0): number {
  let n: number;
  if (typeof valor === 'number') n = valor;
  else if (typeof valor === 'bigint') n = Number(valor);
  else if (typeof valor === 'string') n = valor.trim() === '' ? 0 : Number(valor);
  // `null` vira 0 (ausência de dado = zero), mas `undefined` cai no fallback:
  // é o caso do campo que nem existe no objeto (ex.: status sem inscrição).
  else n = Number(valor);

  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function somarValores(pontos: readonly { valor: number }[]): number {
  return pontos.reduce((acc, ponto) => acc + numeroSeguro(ponto?.valor), 0);
}

/** Arredonda percentuais para 1 casa por padrão (evita `33.33333333333333%` na legenda). */
export function arredondarPercentual(valor: number, casas = 1): number {
  const n = numeroSeguro(valor);
  const fator = 10 ** Math.max(0, Math.floor(numeroSeguro(casas)));
  return Math.round(n * fator) / fator;
}

/** Percentual de `valor` sobre `total`. Total zero devolve 0 — nunca `NaN`/`Infinity`. */
export function calcularPercentual(valor: number, total: number): number {
  const t = numeroSeguro(total);
  if (t <= 0) return 0;
  return arredondarPercentual((numeroSeguro(valor) / t) * 100);
}

/** Anexa o percentual (sobre o total da própria série) a cada ponto. */
export function comPercentuais(pontos: readonly ContagemBruta[]): PontoSerie[] {
  const total = somarValores(pontos);
  return pontos.map((ponto) => {
    const valor = numeroSeguro(ponto?.valor);
    return {
      rotulo: ponto?.rotulo ?? '',
      valor,
      percentual: calcularPercentual(valor, total),
    };
  });
}

/** Aceita `number[]` ou `{ valor }[]` — os dois formatos aparecem nas páginas. */
function extrairValores(valores: readonly (number | { valor: number })[]): number[] {
  return valores.map((item) =>
    typeof item === 'number' ? numeroSeguro(item) : numeroSeguro(item?.valor),
  );
}

/**
 * Maior valor da série, com piso — usado para dimensionar as barras.
 * O piso nunca é menor que 1 porque uma série toda zerada ainda precisa de uma
 * escala válida (divisão por zero no cálculo da altura).
 */
export function maximoSerie(
  valores: readonly (number | { valor: number })[],
  minimo = 1,
): number {
  const piso = Math.max(1, numeroSeguro(minimo, 1));
  const maior = extrairValores(valores).reduce((acc, v) => (v > acc ? v : acc), 0);
  return maior > piso ? maior : piso;
}

const MULTIPLICADORES_AGRADAVEIS = [1, 2, 2.5, 5, 10] as const;

/** Arredonda um passo de eixo para um valor "redondo" (1, 2, 2.5, 5, 10 × 10ⁿ). */
export function passoAgradavel(bruto: number): number {
  const n = numeroSeguro(bruto);
  if (n <= 0) return 1;
  const expoente = Math.floor(Math.log10(n));
  const base = 10 ** expoente;
  const normalizado = n / base;
  const multiplicador =
    MULTIPLICADORES_AGRADAVEIS.find((m) => normalizado <= m) ??
    MULTIPLICADORES_AGRADAVEIS[MULTIPLICADORES_AGRADAVEIS.length - 1];
  return multiplicador * base;
}

/**
 * Limite superior do eixo Y: um múltiplo "redondo" do passo, maior ou igual ao
 * máximo. Ex.: 7 com 4 passos → 8; 100 → 100.
 */
export function escalaLimite(maximo: number, passos = 4): number {
  const partes = Math.max(1, Math.floor(numeroSeguro(passos, 4)));
  const topo = numeroSeguro(maximo);
  // Série minúscula (ex.: 3 inscrições) fica ilegível com passos fracionários
  // (0,75 / 1,5 / ...) — nesse caso usamos uma escala inteira de 0..passos.
  if (topo <= partes) return partes;
  return passoAgradavel(topo / partes) * partes;
}

/** Valores das linhas de grade do eixo Y, de 0 até `limite` (inclusive). */
export function ticksEixo(limite: number, passos = 4): number[] {
  const partes = Math.max(1, Math.floor(numeroSeguro(passos, 4)));
  const topo = numeroSeguro(limite);
  if (topo <= 0) return [0];
  return Array.from({ length: partes + 1 }, (_, i) =>
    Math.round(((topo / partes) * i) * 100) / 100,
  );
}

// ── Ordenação e agrupamento ──────────────────────────────────────────────────

/**
 * Ordena por valor (desc por padrão) SEM mutar a entrada — as listas vindas do
 * Prisma são reaproveitadas em outras seções da página. Empates preservam a
 * ordem original (sort estável), o que mantém os gráficos previsíveis.
 */
export function ordenarPorValor<T extends { valor: number }>(
  pontos: readonly T[],
  direcao: 'asc' | 'desc' = 'desc',
): T[] {
  const sinal = direcao === 'asc' ? 1 : -1;
  return pontos
    .map((ponto, indice) => ({ ponto, indice }))
    .sort(
      (a, b) =>
        (numeroSeguro(a.ponto.valor) - numeroSeguro(b.ponto.valor)) * sinal ||
        a.indice - b.indice,
    )
    .map(({ ponto }) => ponto);
}

/**
 * Soma contagens com o mesmo rótulo. O banco devolve `""` e `"  "` como áreas
 * diferentes (`Projeto.area` é `String @default("")`), e sem isso o gráfico
 * mostraria duas barras "vazias"; normalizamos para um rótulo legível.
 */
export function agruparContagens(
  itens: readonly ContagemBruta[],
  rotuloVazio = AREA_NAO_INFORMADA,
): ContagemBruta[] {
  const ordem: string[] = [];
  const mapa = new Map<string, number>();

  for (const item of itens) {
    const rotulo = (item?.rotulo ?? '').trim() || rotuloVazio;
    if (!mapa.has(rotulo)) ordem.push(rotulo);
    mapa.set(rotulo, (mapa.get(rotulo) ?? 0) + numeroSeguro(item?.valor));
  }

  return ordem.map((rotulo) => ({ rotulo, valor: mapa.get(rotulo) ?? 0 }));
}

/**
 * Mantém as `maximo` maiores categorias e junta o resto em "Outros" — em
 * relatórios abertos (área do projeto é texto livre) a cauda longa polui o
 * gráfico sem informar nada.
 */
export function limitarComOutros(
  pontos: readonly ContagemBruta[],
  maximo: number,
  rotuloOutros = 'Outros',
): ContagemBruta[] {
  const limite = Math.floor(numeroSeguro(maximo));
  if (limite <= 0) return [];

  const ordenados = ordenarPorValor(
    pontos.map((p) => ({ rotulo: p?.rotulo ?? '', valor: numeroSeguro(p?.valor) })),
  );
  if (ordenados.length <= limite) return ordenados;

  const principais = ordenados.slice(0, limite - 1);
  const resto = somarValores(ordenados.slice(limite - 1));
  return [...principais, { rotulo: rotuloOutros, valor: resto }];
}

// ── Séries mensais ───────────────────────────────────────────────────────────

const MESES_CURTOS = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
] as const;

/**
 * Chave `YYYY-MM` de uma data. Usa os getters LOCAIS de propósito: o resto da
 * UI (`formatDateShort`) formata em horário local, e misturar UTC aqui faria a
 * inscrição do dia 1º aparecer no mês anterior.
 */
export function mesChave(data: Date | string | number): string {
  const d = data instanceof Date ? data : new Date(data);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `YYYY-MM` → `jan/25` (rótulo curto do eixo X). Entrada inválida volta como veio. */
export function mesCurto(chave: string): string {
  const [ano, mes] = String(chave ?? '').split('-');
  const indice = Number(mes) - 1;
  if (!ano || ano.length < 4 || !Number.isInteger(indice) || indice < 0 || indice > 11) {
    return String(chave ?? '');
  }
  return `${MESES_CURTOS[indice]}/${ano.slice(2)}`;
}

/** Normaliza `YYYY-MM`, `YYYY-MM-DD` ou ISO completo para `YYYY-MM`. */
export function normalizarChaveMes(periodo: unknown): string {
  if (periodo instanceof Date) return mesChave(periodo);
  const texto = String(periodo ?? '').trim();
  const casamento = /^(\d{4})-(\d{2})/.exec(texto);
  return casamento ? `${casamento[1]}-${casamento[2]}` : '';
}

/**
 * Chaves dos últimos `quantidade` meses, em ordem cronológica crescente,
 * terminando no mês de `referencia`.
 */
export function ultimosMeses(quantidade: number, referencia: Date = new Date()): string[] {
  const total = Math.floor(numeroSeguro(quantidade));
  if (total <= 0) return [];

  const base = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
  return Array.from({ length: total }, (_, indice) => {
    const deslocamento = total - 1 - indice;
    return mesChave(new Date(base.getFullYear(), base.getMonth() - deslocamento, 1));
  });
}

/**
 * Série mensal CONTÍNUA: meses sem nenhuma inscrição entram com 0 em vez de
 * desaparecerem. Sem isso o gráfico "mente" — dois meses com dados viram
 * barras vizinhas, escondendo o intervalo vazio no meio.
 */
export function preencherSerieMensal(
  contagens: readonly ContagemMensal[],
  opcoes: { quantidade: number; referencia?: Date; rotular?: (chave: string) => string },
): ContagemBruta[] {
  const chaves = ultimosMeses(opcoes.quantidade, opcoes.referencia ?? new Date());
  if (chaves.length === 0) return [];

  const porMes = new Map<string, number>();
  for (const contagem of contagens ?? []) {
    const chave = normalizarChaveMes(contagem?.periodo);
    if (!chave) continue;
    porMes.set(chave, (porMes.get(chave) ?? 0) + numeroSeguro(contagem?.total));
  }

  const rotular = opcoes.rotular ?? mesCurto;
  return chaves.map((chave) => ({ rotulo: rotular(chave), valor: porMes.get(chave) ?? 0 }));
}

// ── Séries prontas para os gráficos ──────────────────────────────────────────

/** Converte a lista `{ status, _count }` do groupBy em um mapa status → total. */
export function contagensParaMapa(
  itens: readonly { rotulo: string; valor: number }[],
): Record<string, number> {
  const mapa: Record<string, number> = {};
  for (const item of itens ?? []) {
    const chave = item?.rotulo ?? '';
    mapa[chave] = (mapa[chave] ?? 0) + numeroSeguro(item?.valor);
  }
  return mapa;
}

/**
 * Série de inscrições por status na ordem canônica, com percentuais.
 * `incluirZeros` (padrão `true`) mantém os seis status na legenda do gráfico
 * mesmo quando o projeto não tem nenhuma inscrição em algum deles — sem isso a
 * legenda muda de tamanho a cada projeto e a cor de um status "anda".
 */
export function montarSerieStatus(
  contagens: Readonly<Record<string, number | undefined>>,
  opcoes: { incluirZeros?: boolean } = {},
): PontoSerie[] {
  const incluirZeros = opcoes.incluirZeros ?? true;

  const conhecidos: ContagemBruta[] = STATUS_INSCRICAO.map((status) => ({
    rotulo: ROTULOS_STATUS_INSCRICAO[status],
    valor: numeroSeguro(contagens?.[status]),
  })).filter((ponto) => incluirZeros || ponto.valor > 0);

  // Status fora do enum (dado legado/importado) não pode sumir do relatório.
  const extras: ContagemBruta[] = Object.entries(contagens ?? {})
    .filter(([chave]) => !ehStatusInscricao(chave))
    .map(([chave, valor]) => ({ rotulo: rotuloStatusInscricao(chave), valor: numeroSeguro(valor) }))
    .filter((ponto) => ponto.valor > 0);

  return comPercentuais([...conhecidos, ...ordenarPorValor(extras)]);
}

/** Série de editais por categoria na ordem canônica, com percentuais. */
export function montarSerieCategoriasEdital(
  contagens: Readonly<Record<string, number | undefined>>,
  opcoes: { incluirZeros?: boolean } = {},
): PontoSerie[] {
  const incluirZeros = opcoes.incluirZeros ?? false;

  const conhecidas: ContagemBruta[] = CATEGORIAS_EDITAL.map((categoria) => ({
    rotulo: ROTULOS_CATEGORIA_EDITAL[categoria],
    valor: numeroSeguro(contagens?.[categoria]),
  })).filter((ponto) => incluirZeros || ponto.valor > 0);

  const extras: ContagemBruta[] = Object.entries(contagens ?? {})
    .filter(([chave]) => !(CATEGORIAS_EDITAL as readonly string[]).includes(chave))
    .map(([chave, valor]) => ({ rotulo: rotuloCategoriaEdital(chave), valor: numeroSeguro(valor) }))
    .filter((ponto) => ponto.valor > 0);

  return comPercentuais([...conhecidas, ...ordenarPorValor(extras)]);
}

/**
 * Taxa de ocupação das vagas (0..100). Limitada a 100 no percentual porque é
 * possível haver mais selecionados do que vagas ofertadas (o professor pode
 * selecionar além do previsto) — a barra não pode passar do trilho.
 */
export function taxaOcupacao(preenchidas: number, total: number): number {
  const totalSeguro = numeroSeguro(total);
  if (totalSeguro <= 0) return 0;
  const fracao = numeroSeguro(preenchidas) / totalSeguro;
  return arredondarPercentual(Math.min(fracao, 1) * 100);
}

export type VagaBruta = { rotulo: string; preenchidas: number; total: number };

/** Série de vagas por projeto, ordenada por ocupação (mais cheio primeiro). */
export function montarSerieVagas(itens: readonly VagaBruta[]): SerieVagas[] {
  return (itens ?? [])
    .map((item) => {
      const total = numeroSeguro(item?.total);
      const preenchidas = numeroSeguro(item?.preenchidas);
      return {
        rotulo: item?.rotulo ?? '',
        preenchidas,
        total,
        percentual: taxaOcupacao(preenchidas, total),
      };
    })
    .sort((a, b) => b.percentual - a.percentual || b.preenchidas - a.preenchidas);
}

// ── Formatação ───────────────────────────────────────────────────────────────

/** Número inteiro em pt-BR (`1.234`). Sem casas decimais: os relatórios contam pessoas. */
export function formatarNumero(valor: number): string {
  const n = Math.round(numeroSeguro(valor));
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

/** Percentual formatado (`33,3%`). */
export function formatarPercentual(valor: number, casas = 1): string {
  const n = arredondarPercentual(valor, casas);
  return `${n.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(0, Math.floor(numeroSeguro(casas))),
  })}%`;
}

/** Encurta rótulos longos de eixo/legenda, preservando o texto completo no `<title>` do SVG. */
export function truncarRotulo(rotulo: string, maximo = 14): string {
  const texto = String(rotulo ?? '').trim();
  const limite = Math.max(1, Math.floor(numeroSeguro(maximo, 14)));
  if (texto.length <= limite) return texto;
  return `${texto.slice(0, limite - 1).trimEnd()}…`;
}
