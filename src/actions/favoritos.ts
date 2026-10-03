'use server';

import { prisma } from '@/lib/prisma';
import { resolverUsuarioDaSessao } from '@/lib/usuario-sessao';
import { normalizarEntidade, type EntidadeFavoritavel } from '@/lib/minha-area';

/**
 * Favoritos do estudante (ROADMAP 6.3).
 *
 * Todas as funções recebem o ID token do Firebase e derivam o usuário no
 * SERVIDOR — nunca aceitam um `userId` de fora (mesmo raciocínio de
 * src/actions/meus-dados.ts).
 */

export type FavoritoItem = {
  chave: string;
  entidade: EntidadeFavoritavel;
  entidadeId: string;
  titulo: string;
  subtitulo: string | null;
  href: string;
  cor: string | null;
  /** false quando o item saiu do ar (despublicado) — a UI mostra como indisponível. */
  disponivel: boolean;
  criadoEm: string;
};

type Resultado = { ok: true } | { ok: false; error: string };

async function validarAlvo(
  entidade: EntidadeFavoritavel,
  entidadeId: string,
): Promise<boolean> {
  if (entidade === 'projeto') {
    const p = await prisma.projeto.findFirst({
      where: { id: entidadeId, deleted_at: null },
      select: { id: true },
    });
    return Boolean(p);
  }

  const e = await prisma.edital.findFirst({
    where: { id: entidadeId, deleted_at: null },
    select: { id: true },
  });
  return Boolean(e);
}

/** Favorita/desfavorita. Retorna o estado final para a UI não adivinhar. */
export async function alternarFavorito(
  idToken: string,
  entidadeRaw: string,
  entidadeId: string,
): Promise<{ ok: true; favoritado: boolean } | { ok: false; error: string }> {
  const sessao = await resolverUsuarioDaSessao(idToken);
  if (!sessao.ok) return sessao;

  const entidade = normalizarEntidade(entidadeRaw);
  if (!entidade) return { ok: false, error: 'Tipo de item inválido' };
  if (!entidadeId?.trim()) return { ok: false, error: 'Item inválido' };

  try {
    const existente = await prisma.favorito.findUnique({
      where: {
        user_id_entidade_entidade_id: {
          user_id: sessao.userId,
          entidade,
          entidade_id: entidadeId,
        },
      },
    });

    if (existente) {
      await prisma.favorito.delete({
        where: {
          user_id_entidade_entidade_id: {
            user_id: sessao.userId,
            entidade,
            entidade_id: entidadeId,
          },
        },
      });
      return { ok: true, favoritado: false };
    }

    // Só favorita o que existe de fato — senão a lista do estudante acumula
    // ids órfãos que nunca resolvem para nada.
    if (!(await validarAlvo(entidade, entidadeId))) {
      return { ok: false, error: 'Item não encontrado' };
    }

    await prisma.favorito.create({
      data: { user_id: sessao.userId, entidade, entidade_id: entidadeId },
    });

    return { ok: true, favoritado: true };
  } catch {
    return { ok: false, error: 'Não foi possível atualizar o favorito' };
  }
}

export async function removerFavorito(
  idToken: string,
  entidadeRaw: string,
  entidadeId: string,
): Promise<Resultado> {
  const sessao = await resolverUsuarioDaSessao(idToken);
  if (!sessao.ok) return sessao;

  const entidade = normalizarEntidade(entidadeRaw);
  if (!entidade) return { ok: false, error: 'Tipo de item inválido' };

  try {
    await prisma.favorito.deleteMany({
      where: { user_id: sessao.userId, entidade, entidade_id: entidadeId },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'Não foi possível remover o favorito' };
  }
}

/** Ids favoritados — usado para pintar o coração nas listagens. */
export async function listarIdsFavoritos(idToken: string): Promise<string[]> {
  const sessao = await resolverUsuarioDaSessao(idToken);
  if (!sessao.ok) return [];

  const favoritos = await prisma.favorito.findMany({
    where: { user_id: sessao.userId },
    select: { entidade: true, entidade_id: true },
  });

  return favoritos.map((f) => `${f.entidade}:${f.entidade_id}`);
}

/** Lista completa para a aba "Favoritos" da área do estudante. */
export async function listarMeusFavoritos(idToken: string): Promise<FavoritoItem[]> {
  const sessao = await resolverUsuarioDaSessao(idToken);
  if (!sessao.ok) return [];

  const favoritos = await prisma.favorito.findMany({
    where: { user_id: sessao.userId },
    orderBy: { created_at: 'desc' },
  });

  const projetoIds = favoritos.filter((f) => f.entidade === 'projeto').map((f) => f.entidade_id);
  const editalIds = favoritos.filter((f) => f.entidade === 'edital').map((f) => f.entidade_id);

  const [projetos, editais] = await Promise.all([
    projetoIds.length
      ? prisma.projeto.findMany({
          where: { id: { in: projetoIds } },
          select: {
            id: true, nome: true, slug: true, area: true, corPrimaria: true,
            review_status: true, deleted_at: true,
          },
        })
      : Promise.resolve([]),
    editalIds.length
      ? prisma.edital.findMany({
          where: { id: { in: editalIds } },
          select: {
            id: true, titulo: true, slug: true, categoria: true,
            review_status: true, deleted_at: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const projetosPorId = new Map(projetos.map((p) => [p.id, p]));
  const editaisPorId = new Map(editais.map((e) => [e.id, e]));

  return favoritos.flatMap<FavoritoItem>((favorito) => {
    const criadoEm = favorito.created_at.toISOString();

    if (favorito.entidade === 'projeto') {
      const p = projetosPorId.get(favorito.entidade_id);
      if (!p) return [];
      return [{
        chave: `projeto:${p.id}`,
        entidade: 'projeto' as const,
        entidadeId: p.id,
        titulo: p.nome,
        subtitulo: p.area,
        href: `/projetos/${p.slug}`,
        cor: p.corPrimaria,
        disponivel: p.review_status === 'PUBLICADO' && !p.deleted_at,
        criadoEm,
      }];
    }

    const e = editaisPorId.get(favorito.entidade_id);
    if (!e) return [];
    return [{
      chave: `edital:${e.id}`,
      entidade: 'edital' as const,
      entidadeId: e.id,
      titulo: e.titulo,
      subtitulo: e.categoria,
      href: `/editais/${e.slug}`,
      cor: null,
      disponivel: e.review_status === 'PUBLICADO' && !e.deleted_at,
      criadoEm,
    }];
  });
}
