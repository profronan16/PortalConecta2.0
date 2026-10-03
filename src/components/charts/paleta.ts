/**
 * Paleta dos gráficos (ROADMAP 6.7).
 *
 * As cores são os MESMOS hex de `tailwind.config.ts` (azul-eletrico,
 * roxo-luminoso, rosa-vibrante, ciano-claro, dourado-ifizinha e os tons 300/400
 * das escalas). Copiadas como string — e não como classes Tailwind — porque
 * atributos de apresentação do SVG (`fill`/`stroke`) não aceitam classes
 * utilitárias arbitrárias de forma confiável em todos os navegadores.
 */

export const CORES_GRAFICO = {
  azul: '#2F52D3', // azul-eletrico
  roxo: '#7B24C7', // roxo-luminoso
  rosa: '#E83D89', // rosa-vibrante
  ciano: '#17A2B8', // ciano-claro
  dourado: '#FFD700', // dourado-ifizinha
  azulClaro: '#8AA3F3',
  roxoClaro: '#B97CF3',
  rosaClaro: '#F36DAC',
  cianoClaro: '#5AD1E1',
  neutro: '#9CA3AF',
  /** Cinzas do Tailwind usados em eixos/grade — precisam existir nos dois temas. */
  grade: '#E5E7EB',
  trilho: '#F3F4F6',
  texto: '#6B7280',
  textoTitulo: '#374151',
} as const;

/** Sequência usada quando o rótulo não tem cor fixa (categorias de texto livre). */
export const PALETA_CICLICA: readonly string[] = [
  CORES_GRAFICO.azul,
  CORES_GRAFICO.roxo,
  CORES_GRAFICO.ciano,
  CORES_GRAFICO.rosa,
  CORES_GRAFICO.dourado,
  CORES_GRAFICO.azulClaro,
  CORES_GRAFICO.roxoClaro,
  CORES_GRAFICO.cianoClaro,
  CORES_GRAFICO.rosaClaro,
];

/**
 * Cor fixa por rótulo. Status de inscrição e categoria de edital têm cor
 * estável de propósito: a mesma categoria precisa ter a mesma cor no gráfico do
 * admin e no do professor, senão o relatório vira adivinhação.
 */
const CORES_POR_ROTULO: Record<string, string> = {
  // Status de inscrição (ver ROTULOS_STATUS_INSCRICAO)
  Recebida: CORES_GRAFICO.azul,
  'Em análise': CORES_GRAFICO.dourado,
  Selecionado: CORES_GRAFICO.ciano,
  'Lista de espera': CORES_GRAFICO.roxo,
  'Não selecionado': CORES_GRAFICO.rosa,
  Desistente: CORES_GRAFICO.neutro,
  // Categorias de edital (ver ROTULOS_CATEGORIA_EDITAL)
  Bolsas: CORES_GRAFICO.dourado,
  'Auxílios': CORES_GRAFICO.ciano,
  'Extensão': CORES_GRAFICO.azul,
  Pesquisa: CORES_GRAFICO.roxo,
  Ensino: CORES_GRAFICO.azulClaro,
  Eventos: CORES_GRAFICO.rosa,
  'Estágios': CORES_GRAFICO.rosaClaro,
  Resultados: CORES_GRAFICO.cianoClaro,
  Outros: CORES_GRAFICO.neutro,
};

/** Cor de um rótulo conhecido ou, na falta dele, a próxima cor da paleta cíclica. */
export function corDoRotulo(rotulo: string, indice = 0): string {
  const conhecida = CORES_POR_ROTULO[rotulo];
  if (conhecida) return conhecida;
  const i = Math.abs(Math.floor(indice)) % PALETA_CICLICA.length;
  return PALETA_CICLICA[i];
}
