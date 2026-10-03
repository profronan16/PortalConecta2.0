/**
 * Supabase Vector Client — Operações Vetoriais em Postgres + pgvector
 * 
 * Gerencia inserção de chunks com embeddings vetoriais e execução de busca
 * por similaridade por cosseno utilizando a extensão pgvector.
 */

import { prisma } from '@/lib/prisma';
import { cosineSimilarity } from '@/lib/embeddings';
import { createLogger } from '@/lib/logger';

const log = createLogger('busca-vetorial');

export interface ChunkToInsert {
  id?: string;
  documentoId: string;
  documentoVersao?: number;
  chunkIndex: number;
  texto: string;
  secao?: string | null;
  categoria?: string | null;
  paginaInicial?: number | null;
  paginaFinal?: number | null;
  metadata?: Record<string, unknown>;
  embedding: number[];
  ativo?: boolean;
}

export interface ChunkSearchResult {
  id: string;
  documento_id: string;
  chunk_index: number;
  texto: string;
  secao: string | null;
  categoria: string | null;
  pagina_inicial: number | null;
  pagina_final: number | null;
  metadata: Record<string, unknown>;
  documento_titulo: string;
  documento_tipo: string;
  similarity: number;
}

export interface SearchOptions {
  queryEmbedding: number[];
  matchCount?: number;
  filterCategoria?: string | null;
  filterTipo?: string | null;
  minSimilarity?: number;
}

/**
 * Salva chunks com seus respectivos vetores de embedding no banco.
 */
export async function saveChunksWithEmbeddings(chunks: ChunkToInsert[]): Promise<number> {
  if (chunks.length === 0) return 0;

  let insertedCount = 0;

  for (const chunk of chunks) {
    const chunkId = chunk.id || `chk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const metadataJson = JSON.stringify(chunk.metadata || {});
    const vectorString = `[${chunk.embedding.join(',')}]`;
    const ativo = chunk.ativo !== undefined ? chunk.ativo : true;
    const versao = chunk.documentoVersao || 1;

    try {
      // Inserção com cast explícito para o tipo vector do pgvector
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "chunks_kb" (
          "id", "documento_id", "documento_versao", "chunk_index",
          "texto", "secao", "categoria", "pagina_inicial", "pagina_final",
          "metadata", "ativo", "created_at", "embedding"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW(), $12::vector)
        ON CONFLICT ("id") DO UPDATE SET
          "texto" = EXCLUDED."texto",
          "secao" = EXCLUDED."secao",
          "categoria" = EXCLUDED."categoria",
          "metadata" = EXCLUDED."metadata",
          "ativo" = EXCLUDED."ativo",
          "embedding" = EXCLUDED."embedding"
        `,
        chunkId,
        chunk.documentoId,
        versao,
        chunk.chunkIndex,
        chunk.texto,
        chunk.secao || null,
        chunk.categoria || null,
        chunk.paginaInicial || null,
        chunk.paginaFinal || null,
        metadataJson,
        ativo,
        vectorString
      );

      insertedCount++;
    } catch (err) {
      log.warn('Tentativa com vector falhou, usando fallback sem coluna vector', {
        chunkIndex: chunk.chunkIndex,
        documentoId: chunk.documentoId,
        erro: err instanceof Error ? err.message : String(err),
      });
      // Fallback: se a coluna vector não existir (ambiente não migrado), grava/atualiza
      // via Prisma padrão. upsert (não create) porque o chunk pode já existir — reindexar
      // um chunk existente com create() quebraria por violação de chave primária.
      const fallbackData = {
        documentoId: chunk.documentoId,
        documentoVersao: versao,
        chunkIndex: chunk.chunkIndex,
        texto: chunk.texto,
        secao: chunk.secao || null,
        categoria: chunk.categoria || null,
        paginaInicial: chunk.paginaInicial || null,
        paginaFinal: chunk.paginaFinal || null,
        metadata: chunk.metadata as any,
        ativo,
      };
      await prisma.chunkKb.upsert({
        where: { id: chunkId },
        create: { id: chunkId, ...fallbackData },
        update: fallbackData,
      });
      insertedCount++;
    }
  }

  return insertedCount;
}

/**
 * Realiza a busca vetorial por similaridade de cosseno.
 */
export async function searchSimilarChunks(options: SearchOptions): Promise<ChunkSearchResult[]> {
  const {
    queryEmbedding,
    matchCount = 5,
    filterCategoria = null,
    filterTipo = null,
    minSimilarity = 0.2,
  } = options;

  const vectorString = `[${queryEmbedding.join(',')}]`;

  // 1. Tentar executar a função RPC match_chunks_kb nativa no PostgreSQL
  try {
    const results = await prisma.$queryRawUnsafe<ChunkSearchResult[]>(
      `
      SELECT * FROM match_chunks_kb(
        $1::vector,
        $2::int,
        $3::text,
        $4::text,
        $5::float
      )
      `,
      vectorString,
      matchCount,
      filterCategoria,
      filterTipo,
      minSimilarity
    );

    if (Array.isArray(results) && results.length > 0) {
      return results;
    }
  } catch (err) {
    log.warn('RPC match_chunks_kb indisponível, tentando query direta pgvector', {
      erro: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Tentar busca direta SQL usando o operador <=> do pgvector
  try {
    let whereClause = `WHERE c.ativo = true AND d.ativo = true AND c.embedding IS NOT NULL`;
    const params: unknown[] = [vectorString, matchCount];
    let paramIndex = 3;

    if (filterCategoria) {
      whereClause += ` AND (c.categoria = $${paramIndex} OR (c.metadata->>'categoria') = $${paramIndex})`;
      params.push(filterCategoria);
      paramIndex++;
    }

    if (filterTipo) {
      whereClause += ` AND d.tipo = $${paramIndex}`;
      params.push(filterTipo);
      paramIndex++;
    }

    const results = await prisma.$queryRawUnsafe<ChunkSearchResult[]>(
      `
      SELECT
        c.id,
        c.documento_id,
        c.chunk_index,
        c.texto,
        c.secao,
        c.categoria,
        c.pagina_inicial,
        c.pagina_final,
        c.metadata,
        d.titulo AS documento_titulo,
        d.tipo AS documento_tipo,
        (1 - (c.embedding <=> $1::vector))::float AS similarity
      FROM "chunks_kb" c
      JOIN "documentos_kb" d ON d.id = c.documento_id
      ${whereClause}
      ORDER BY c.embedding <=> $1::vector
      LIMIT $2::int
      `,
      ...params
    );

    if (Array.isArray(results) && results.length > 0) {
      return results.filter((r) => r.similarity >= minSimilarity);
    }
  } catch (err) {
    log.warn('Query direta pgvector falhou, usando fallback em memória', {
      erro: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Fallback gracioso em memória (para ambientes de dev antes da migração do pgvector)
  const candidateChunks = await prisma.chunkKb.findMany({
    where: {
      ativo: true,
      documento: {
        ativo: true,
        ...(filterTipo ? { tipo: filterTipo } : {}),
      },
      ...(filterCategoria ? { categoria: filterCategoria } : {}),
    },
    include: {
      documento: {
        select: {
          titulo: true,
          tipo: true,
        },
      },
    },
    take: 50,
  });

  const scoredResults: ChunkSearchResult[] = candidateChunks.map((chunk) => {
    // Se tiver vetor no metadata ou calcular score básico
    const sim = 0.5; // score base quando em fallback
    return {
      id: chunk.id,
      documento_id: chunk.documentoId,
      chunk_index: chunk.chunkIndex,
      texto: chunk.texto,
      secao: chunk.secao,
      categoria: chunk.categoria,
      pagina_inicial: chunk.paginaInicial,
      pagina_final: chunk.paginaFinal,
      metadata: (chunk.metadata || {}) as Record<string, unknown>,
      documento_titulo: chunk.documento.titulo,
      documento_tipo: chunk.documento.tipo,
      similarity: sim,
    };
  });

  return scoredResults.slice(0, matchCount);
}

/**
 * Desativa versões antigas de um mesmo documento/projeto para versionamento limpo.
 */
export async function deactivateOldDocumentVersions(refIdOrTitle: string, currentDocId: string) {
  await prisma.documentoKb.updateMany({
    where: {
      id: { not: currentDocId },
      OR: [
        { refId: refIdOrTitle },
        { titulo: refIdOrTitle },
      ],
    },
    data: {
      ativo: false,
    },
  });

  await prisma.chunkKb.updateMany({
    where: {
      documentoId: { not: currentDocId },
      documento: {
        OR: [
          { refId: refIdOrTitle },
          { titulo: refIdOrTitle },
        ],
      },
    },
    data: {
      ativo: false,
    },
  });
}
