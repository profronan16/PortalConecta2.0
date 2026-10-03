/**
 * Indexador — última etapa da pipeline de ingestão. Gera embeddings para os
 * chunks já curados (Etapa 3) e grava no pgvector. Diferente da curadoria,
 * falha aqui É bloqueante: sem embedding o chunk não é encontrado pela busca
 * vetorial, então o documento não pode ficar marcado como `indexed`.
 */

import { prisma } from '@/lib/prisma';
import { generateBatchEmbeddings, validateEmbedding } from '@/lib/embeddings';
import { saveChunksWithEmbeddings } from '@/lib/busca-vetorial';
import { createLogger } from '@/lib/logger';

const log = createLogger('indexador');

export async function indexarDocumentoKb(documentoId: string): Promise<void> {
  const job = await prisma.job.create({
    data: { tipo: 'kb_embed', payload: { documentoId }, status: 'rodando' },
  });
  log.info('Indexação iniciada', { documentoId, jobId: job.id });

  try {
    const doc = await prisma.documentoKb.findUnique({
      where: { id: documentoId },
      include: { chunks: { where: { ativo: true }, orderBy: { chunkIndex: 'asc' } } },
    });
    if (!doc) throw new Error('Documento não encontrado');
    if (doc.chunks.length === 0) throw new Error('Documento não tem chunks ativos para indexar');

    await prisma.documentoKb.update({ where: { id: documentoId }, data: { status: 'embedding' } });

    // Embeddar seção + tabela reformulada (quando existir) em vez do texto cru
    // dá um sinal semântico melhor do que a tabela bagunçada sozinha.
    const textos = doc.chunks.map((c) => {
      const metadata = (c.metadata ?? {}) as Record<string, unknown>;
      const tabela = typeof metadata.tabela_reformatada === 'string' ? metadata.tabela_reformatada : null;
      const base = tabela ? `${c.texto}\n\n${tabela}` : c.texto;
      return c.secao ? `${c.secao}: ${base}` : base;
    });

    const embeddings = await generateBatchEmbeddings(textos);
    embeddings.forEach((e) => validateEmbedding(e));

    await saveChunksWithEmbeddings(
      doc.chunks.map((c, i) => ({
        id: c.id,
        documentoId: c.documentoId,
        documentoVersao: c.documentoVersao,
        chunkIndex: c.chunkIndex,
        texto: c.texto,
        secao: c.secao,
        categoria: c.categoria,
        paginaInicial: c.paginaInicial,
        paginaFinal: c.paginaFinal,
        metadata: (c.metadata ?? {}) as Record<string, unknown>,
        ativo: c.ativo,
        embedding: embeddings[i],
      }))
    );

    await prisma.documentoKb.update({
      where: { id: documentoId },
      data: {
        status: 'indexed',
        processadoEm: new Date(),
        modeloEmbedding: process.env.EMBEDDING_MODEL || 'gemini-embedding-2',
        embeddingDimensions: embeddings[0]?.length ?? 1536,
      },
    });

    await prisma.job.update({ where: { id: job.id }, data: { status: 'ok' } });
    log.info('Indexação concluída', { documentoId, jobId: job.id, totalChunks: doc.chunks.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('Indexação falhou', { documentoId, jobId: job.id, erro: msg });
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'erro', erro: msg, tentativas: { increment: 1 } },
    });
    await prisma.documentoKb
      .update({ where: { id: documentoId }, data: { status: 'failed', erro: msg } })
      .catch(() => {});
  }
}
