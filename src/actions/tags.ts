'use server';

import { prisma } from '@/lib/prisma';
import { DEEPSEEK_MODEL } from '@/lib/llm';

type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

/** Sem checagem nenhuma antes (achado S19) — não chamadas por nenhuma página hoje, mas continuam invocáveis diretamente como Server Actions. */
async function requireAdminEmail(email?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!email) return { ok: false, error: 'Não autenticado' };
  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  if (user?.role !== 'ADMIN') return { ok: false, error: 'Acesso negado: apenas administradores' };
  return { ok: true };
}

/**
 * Lista todas as tags do sistema
 */
export async function listTags() {
  return prisma.projetoTag.groupBy({
    by: ['tag'],
    _count: { tag: true },
    orderBy: { _count: { tag: 'desc' } },
  });
}

/**
 * Sugere tags para um projeto/baseado no resumo
 */
export async function sugerirTags(
  nome: string,
  resumo: string,
  area: string
): Promise<ActionResult<string[]>> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'DEEPSEEK_API_KEY não configurada' };
  }

  const TAGS_DISPONIVEIS = [
    'Tecnologia', 'Informática', 'Robótica', 'Agronomia', 'Ecologia',
    'Meio Ambiente', 'Eletrônica', 'Educação', 'Arte', 'Música',
    'Ed. Física', 'Jogos', 'Saúde', 'Direito', 'Comunicação',
    'Administração', 'Economia', 'Alimentos', 'Veterinária', 'Física',
    'Química', 'Biologia', 'Matemática', 'Letras', 'História',
    'Geografia', 'Filosofia', 'Sociologia', 'Psicologia', 'Pedagogia',
  ];

  const prompt = `Analise o projeto abaixo e sugira as tags mais relevantes da lista disponível.

PROJETO: ${nome}
ÁREA: ${area}
RESUMO: ${resumo}

TAGS DISPONÍVEIS: ${TAGS_DISPONIVEIS.join(', ')}

Responda APENAS com as tags separadas por vírgula (máximo 5 tags). Exemplo: Tecnologia, Robótica, Educação`;

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: 'Você é um classificador de projetos acadêmicos. Responda apenas com tags separadas por vírgula.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 100,
    }),
  });

  if (!response.ok) {
    return { ok: false, error: 'Erro ao sugerir tags' };
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  // Extrair tags da resposta
  const tags = content
    .split(',')
    .map((t: string) => t.trim())
    .filter((t: string) => t.length > 0 && t.length < 50);

  return { ok: true, data: tags.slice(0, 5) };
}

/**
 * Adiciona tags a um projeto
 */
export async function adicionarTagsProjeto(
  projetoId: string,
  tags: string[],
  origem: 'MANUAL' | 'IA',
  callerEmail: string
): Promise<ActionResult> {
  try {
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    // Remover tags existentes
    await prisma.projetoTag.deleteMany({
      where: { projeto_id: projetoId },
    });

    // Adicionar novas tags
    if (tags.length > 0) {
      await prisma.projetoTag.createMany({
        data: tags.map((tag) => ({
          projeto_id: projetoId,
          tag,
          origem,
          aprovada: origem === 'MANUAL',
        })),
      });
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Aprova tags sugeridas por IA
 */
export async function aprovarTag(
  projetoId: string,
  tag: string,
  callerEmail: string
): Promise<ActionResult> {
  try {
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    await prisma.projetoTag.update({
      where: {
        projeto_id_tag: { projeto_id: projetoId, tag },
      },
      data: { aprovada: true },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Remove uma tag de um projeto
 */
export async function removerTag(
  projetoId: string,
  tag: string,
  callerEmail: string
): Promise<ActionResult> {
  try {
    const auth = await requireAdminEmail(callerEmail);
    if (!auth.ok) return auth;

    await prisma.projetoTag.delete({
      where: {
        projeto_id_tag: { projeto_id: projetoId, tag },
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
