import { NextResponse } from 'next/server';
import { DEEPSEEK_MODEL } from '@/lib/llm';

const SYSTEM_PROMPT = `Você é a IFizinha, assistente virtual do Portal Conecta do IFPR Campus Ivaiporã.
Sua tarefa é traduzir editais institucionais para linguagem simples e acessível para estudantes.

REGRAS:
1. Use linguagem jovem, amigável e direta
2. Trate o estudante por "você"
3. Explique termos difíceis
4. Seja específica sobre prazos e documentos
5. Nunca invente informações — use apenas o que foi fornecido
6. Mantenha o tom acolhedor mas institucional
7. Responda APENAS com JSON válido, sem texto fora do JSON

FORMATO DE SAÍDA (JSON estrito):
{
  "oquee": "Explicação simples do que é o edital",
  "quempode": "Quem pode participar",
  "beneficios": "Quais os benefícios",
  "documentos": "Documentos necessários",
  "comoinscrever": "Como se inscrever",
  "prazo": "Prazos importantes",
  "observacoes": "Observações adicionais (pode ser vazio)"
}`;

export async function POST(request: Request) {
  const body = await request.json();
  const { titulo, resumo, categoria, dataEncerramento } = body;

  if (!titulo || !resumo) {
    return NextResponse.json({ error: 'Título e resumo são obrigatórios' }, { status: 400 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'DEEPSEEK_API_KEY não configurada' }, { status: 500 });
  }

  const userMessage = `Traduza este edital para linguagem simples:

TÍTULO: ${titulo}
CATEGORIA: ${categoria}
RESUMO: ${resumo}
${dataEncerramento ? `DATA DE ENCERRAMENTO: ${dataEncerramento}` : ''}

Gere a tradução completa nos campos do JSON.`;

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('DeepSeek error:', JSON.stringify(data));
    return NextResponse.json({ error: data.error?.message || `API error ${response.status}` }, { status: 500 });
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    return NextResponse.json({ error: 'Resposta vazia da IA' }, { status: 500 });
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('No JSON in response:', content.slice(0, 300));
    return NextResponse.json({ error: 'IA não retornou JSON válido' }, { status: 500 });
  }

  const traducao = JSON.parse(jsonMatch[0]);
  return NextResponse.json({ traducao });
}
