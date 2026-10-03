/**
 * Processador de documentos RAG com IA
 * Organiza texto, extrai links, gera tags - economico em tokens
 */

import { DEEPSEEK_MODEL } from '@/lib/llm';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

interface ProcessedDocument {
  resumo: string;
  tags: string[];
  links: string[];
  sections: Array<{
    titulo: string;
    conteudo: string;
    tags: string[];
  }>;
}

/**
 * Processa um documento com IA para organizar conteúdo e gerar tags
 * Usa ~1000 tokens por documento
 */
export async function processDocumentWithAI(
  titulo: string,
  conteudoRaw: string
): Promise<ProcessedDocument> {
  if (!DEEPSEEK_API_KEY) {
    // Fallback: processamento sem IA
    return processWithoutAI(titulo, conteudoRaw);
  }

  // Limitar input para ~4000 palavras
  const palavras = conteudoRaw.split(/\s+/);
  const conteudoLimitado = palavras.slice(0, 4000).join(' ');

  const prompt = `Você é um assistente que processa documentos institucionais do IFPR Campus Ivaiporã para alimentar um chatbot.

Analise o documento abaixo e retorne UM JSON válido com exatamente esta estrutura:

{
  "resumo": "Resumo completo e claro do documento em 3-4 frases. Descreva O QUE é o documento, PARA QUE serve e os PONTOS PRINCIPAIS. NÃO corta a frase no meio.",
  "tags": ["tag1", "tag2", ...],
  "links": ["url1", "url2", ...],
  "sections": [
    {"titulo": "Nome da Seção", "conteudo": "Resumo da seção em 2-3 frases", "tags": ["tag1"]}
  ]
}

REGRAS PARA TAGS:
- Tags devem ser palavras-chave relevantes para BUSCA (minusculas, sem acento)
- Exemplos bons: "edital", "bolsa", "monitoria", "inscricao", "prazo", "selecao", "requisito"
- Exemplos ruins: "o", "de", "para", "com" (palavras comuns não servem)
- Retorne 5-15 tags que realmente ajudem a encontrar este documento

REGRAS PARA SEÇÕES:
- Identifique as seções principais do documento (títulos, tópicos)
- Cada seção deve ter um título claro e um resumo

REGRAS GERAIS:
- NÃO invente informações que não estejam no documento
- Retorne APENAS o JSON, sem texto antes ou depois
- O resumo DEVE ser uma frase completa (não termine com "...")

Documento: ${titulo}

Conteudo:
${conteudoLimitado}`;

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      console.error('DeepSeek API error:', response.status);
      return processWithoutAI(titulo, conteudoRaw);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return processWithoutAI(titulo, conteudoRaw);
    }

    const parsed = JSON.parse(content);
    return {
      resumo: parsed.resumo || '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      links: Array.isArray(parsed.links) ? parsed.links : [],
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
    };
  } catch (e) {
    console.error('Erro ao processar com IA:', e);
    return processWithoutAI(titulo, conteudoRaw);
  }
}

/**
 * Processamento sem IA - extrai tags e links por regex
 */
function processWithoutAI(titulo: string, conteudo: string): ProcessedDocument {
  // Extrair links
  const urlRegex = /https?:\/\/[^\s]+/g;
  const links = Array.from(new Set(conteudo.match(urlRegex) || []));

  // Gerar tags por palavras-chave
  const palavrasChave = [
    'edital', 'projeto', 'inscricao', 'bolsa', 'auxilio', 'estagio',
    'monitoria', 'extensao', 'pesquisa', 'ensino', 'inovacao',
    'prazo', 'requisito', 'documentacao', 'selecao', 'resultado',
    'ifpr', 'ivaipora', 'campus', 'aluno', 'professor',
  ];

  const conteudoLower = conteudo.toLowerCase();
  const tags = palavrasChave.filter(tag => conteudoLower.includes(tag));

  // Adicionar tags do título
  const tituloLower = titulo.toLowerCase();
  if (tituloLower.includes('edital')) tags.push('edital');
  if (tituloLower.includes('projeto')) tags.push('projeto');
  if (tituloLower.includes('bolsa')) tags.push('bolsa');

  // Criar seções básicas por parágrafos
  const paragrafos = conteudo.split(/\n\n+/).filter(p => p.trim().length > 50);
  const sections = paragrafos.slice(0, 5).map((p, i) => ({
    titulo: `Seção ${i + 1}`,
    conteudo: p.slice(0, 200),
    tags: [],
  }));

  return {
    resumo: paragrafos[0]?.slice(0, 200) || titulo,
    tags: Array.from(new Set(tags)).slice(0, 10),
    links,
    sections,
  };
}

/**
 * Processa chunks com tags específicas
 */
export function generateChunkTags(
  chunkContent: string,
  documentTags: string[]
): string[] {
  const contentLower = chunkContent.toLowerCase();
  const chunkTags: string[] = [];

  // Tags do documento que aparecem no chunk
  for (const tag of documentTags) {
    if (contentLower.includes(tag)) {
      chunkTags.push(tag);
    }
  }

  // Tags específicas do chunk
  const specificKeywords = [
    'prazo', 'data', 'valor', 'vaga', 'requisito', 'documento',
    'inscricao', 'selecao', 'resultado', 'contato', 'email', 'telefone',
  ];

  for (const keyword of specificKeywords) {
    if (contentLower.includes(keyword) && !chunkTags.includes(keyword)) {
      chunkTags.push(keyword);
    }
  }

  return chunkTags.slice(0, 5);
}
