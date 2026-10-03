import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { detectFileType, extractDocument, ALLOWED_EXTENSIONS } from '@/lib/document-extract';
import { CategoriaEdital } from '@prisma/client';
import { DEEPSEEK_MODEL } from '@/lib/llm';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_WORDS = 6000;

const CATEGORIAS_VALIDAS = new Set<string>(Object.values(CategoriaEdital));

const SYSTEM_PROMPT = `Você é um assistente que extrai dados estruturados de editais institucionais do IFPR Campus Ivaiporã, a partir do texto bruto extraído de um PDF.

Analise o texto do edital e retorne APENAS um JSON válido com exatamente esta estrutura:

{
  "titulo": "Título oficial do edital (ex: EDITAL Nº 01/2025 - PROGRAMA DE MONITORIA)",
  "categoria": "uma destas opções: BOLSAS | AUXILIOS | EXTENSAO | PESQUISA | ENSINO | EVENTOS | ESTAGIOS | RESULTADOS",
  "resumo": "Resumo objetivo do edital em 2-4 frases, para exibição na listagem pública",
  "dataEncerramento": "Data final das inscrições no formato YYYY-MM-DD, ou null se não encontrada",
  "linkOficial": "URL oficial do edital/instituição encontrada no texto, ou string vazia se não houver",
  "traducaoIFizinha": {
    "oquee": "Explicação simples do que é o edital, em linguagem acessível para estudantes",
    "quempode": "Quem pode participar/se inscrever",
    "beneficios": "Quais os benefícios (valores de bolsa, auxílio, carga horária etc.)",
    "documentos": "Documentos necessários para inscrição",
    "comoinscrever": "Como e onde se inscrever",
    "prazo": "Prazos importantes (inscrição, resultado, recurso)",
    "observacoes": "Observações adicionais relevantes (pode ser string vazia)"
  }
}

REGRAS:
1. Use APENAS informações presentes no texto — nunca invente dados
2. Se um campo não for encontrado no texto, retorne string vazia ("") ou null (para dataEncerramento)
3. Use linguagem jovem, amigável e direta nos campos de "traducaoIFizinha", tratando o estudante por "você"
4. "categoria" deve ser exatamente um dos valores da lista, em maiúsculas
5. Responda APENAS com o JSON, sem texto antes ou depois`;

async function isAdmin(email: string | null): Promise<boolean> {
  if (!email) return false;
  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  return user?.role === 'ADMIN';
}

function truncateWords(text: string, maxWords: number): string {
  const palavras = text.split(/\s+/);
  return palavras.slice(0, maxWords).join(' ');
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

type TraducaoIFizinha = {
  oquee: string; quempode: string; beneficios: string; documentos: string;
  comoinscrever: string; prazo: string; observacoes: string;
};

function sanitizeTraducao(raw: unknown): TraducaoIFizinha {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const field = (key: string) => (typeof obj[key] === 'string' ? (obj[key] as string).trim() : '');
  return {
    oquee: field('oquee'),
    quempode: field('quempode'),
    beneficios: field('beneficios'),
    documentos: field('documentos'),
    comoinscrever: field('comoinscrever'),
    prazo: field('prazo'),
    observacoes: field('observacoes'),
  };
}

export async function POST(request: NextRequest) {
  let file: File | null;
  let adminEmail: string | null;
  try {
    const formData = await request.formData();
    file = formData.get('file') as File | null;
    adminEmail = formData.get('adminEmail') as string | null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao processar o upload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  let admin: boolean;
  try {
    admin = await isAdmin(adminEmail);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao verificar permissões';
    console.error('isAdmin check failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!admin) {
    return NextResponse.json({ error: 'Acesso negado: apenas administradores podem extrair dados de editais' }, { status: 403 });
  }

  if (!file) {
    return NextResponse.json({ error: 'Arquivo é obrigatório' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: `Arquivo excede o limite de ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB` }, { status: 400 });
  }

  const fileType = detectFileType(file);
  if (!fileType) {
    return NextResponse.json(
      { error: 'Tipo de arquivo não suportado', allowed: ALLOWED_EXTENSIONS.join(', ') },
      { status: 400 }
    );
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'DEEPSEEK_API_KEY não configurada' }, { status: 500 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let extracted;
  try {
    extracted = await extractDocument(buffer, fileType);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao ler o arquivo';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!extracted.text.trim()) {
    const msg = extracted.hasTextLayer === false
      ? 'PDF sem camada de texto (provavelmente escaneado). Converta para PDF pesquisável ou preencha manualmente.'
      : 'Não foi possível extrair texto do arquivo.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const conteudo = truncateWords(extracted.text, MAX_WORDS);

  let response: Response;
  try {
    response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Texto extraído do edital:\n\n${conteudo}` },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha de rede ao chamar a IA';
    console.error('DeepSeek fetch failed:', msg);
    return NextResponse.json({ error: `Não foi possível conectar com a IA: ${msg}` }, { status: 502 });
  }

  let data: { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  try {
    data = await response.json();
  } catch {
    const body = await response.text().catch(() => '');
    console.error('DeepSeek returned non-JSON response:', response.status, body.slice(0, 300));
    return NextResponse.json({ error: `Resposta inválida da IA (${response.status})` }, { status: 502 });
  }

  if (!response.ok) {
    console.error('DeepSeek error:', JSON.stringify(data));
    return NextResponse.json({ error: data.error?.message || `Erro da IA (${response.status})` }, { status: 500 });
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    return NextResponse.json({ error: 'Resposta vazia da IA' }, { status: 500 });
  }

  let parsed: Record<string, unknown>;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
  } catch {
    console.error('IA não retornou JSON válido:', content.slice(0, 300));
    return NextResponse.json({ error: 'IA não retornou um JSON válido' }, { status: 500 });
  }

  const titulo = typeof parsed.titulo === 'string' ? parsed.titulo.trim().slice(0, 300) : '';
  const resumo = typeof parsed.resumo === 'string' ? parsed.resumo.trim().slice(0, 2000) : '';
  const categoria = typeof parsed.categoria === 'string' && CATEGORIAS_VALIDAS.has(parsed.categoria)
    ? (parsed.categoria as CategoriaEdital)
    : undefined;
  const dataEncerramento = isValidIsoDate(parsed.dataEncerramento) ? parsed.dataEncerramento : undefined;
  const linkOficial = typeof parsed.linkOficial === 'string' && /^https?:\/\//.test(parsed.linkOficial.trim())
    ? parsed.linkOficial.trim()
    : undefined;
  const traducaoIFizinha = sanitizeTraducao(parsed.traducaoIFizinha);

  return NextResponse.json({
    ok: true,
    data: {
      titulo, resumo, categoria, dataEncerramento, linkOficial, traducaoIFizinha,
      totalPaginas: extracted.pages,
    },
  });
}
