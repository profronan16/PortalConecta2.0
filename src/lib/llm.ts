/**
 * Camada de LLM desacoplada de provider — hoje usa DeepSeek (chave já configurada).
 * Trocar para Claude API no futuro é mudar só este arquivo; nenhum call site muda.
 *
 * ─── SOBRE O NOME DO MODELO ───────────────────────────────────────────────────
 * Este arquivo é a FONTE ÚNICA do nome do modelo e do endpoint do DeepSeek.
 * Antes, `'deepseek-chat'` estava repetido em 6 arquivos (aqui, em
 * /api/chat, /api/ai/ifizinha, /api/admin/editais/extract-pdf, actions/tags e
 * lib/rag-processor), então trocar de modelo exigia caçar strings pelo projeto
 * inteiro — e esquecer uma significava um call site usando um modelo diferente.
 *
 * Os modelos oficiais hoje são `deepseek-flash` (V4.1-Flash) e
 * `deepseek-v4-pro`. O nome `deepseek-chat` continua funcionando como ALIAS
 * (verificado por chamada real à API: a resposta trouxe `model: "deepseek-flash"`),
 * mas depender de um alias legado é risco desnecessário — se ele for aposentado,
 * todo o chat para de funcionar sem aviso.
 *
 * Configure com `DEEPSEEK_MODEL` no .env para trocar sem tocar em código.
 */
export const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

/** Modelo oficial. `deepseek-chat` é alias legado; `deepseek-flash` é o nome atual. */
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';

export interface LlmMessage {
  role: 'system' | 'user';
  content: string;
}

export interface LlmCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export function isLlmConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

/**
 * Gera uma completion de texto. Lança erro se a chamada falhar após as retentativas
 * — o chamador decide como degradar (ex.: seguir sem enriquecimento de IA).
 */
export async function generateCompletion(
  messages: LlmMessage[],
  options: LlmCompletionOptions = {}
): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY não configurada');
  }

  const { temperature = 0.3, maxTokens = 1500, jsonMode = false } = options;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages,
          temperature,
          max_tokens: maxTokens,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`LLM API error (${response.status}): ${body.slice(0, 300)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('LLM retornou resposta vazia');
      return content;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 500));
      }
    }
  }

  throw lastError || new Error('Falha ao chamar LLM após retentativas');
}

/**
 * Extrai o primeiro objeto JSON válido de uma resposta de texto (tolera texto
 * extra antes/depois, que alguns modelos inserem mesmo em modo JSON).
 */
export function parseJsonResponse<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Resposta da IA não contém um JSON válido');
  return JSON.parse(match[0]) as T;
}
