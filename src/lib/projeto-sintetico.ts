/**
 * Projeto sintético — Etapa 5 do plano RAG. Gera um `DocumentoKb` (tipo
 * `projeto_sintetico`) a partir dos dados estruturados de um `Projeto`, para
 * que a IFizinha encontre projetos pela mesma busca vetorial usada em
 * documentos institucionais, em vez de só pela busca por campos em
 * `buscarContexto` (`/api/chat`). Chamado depois de qualquer criação/edição de
 * projeto (admin, professor, sync SUAP) — nunca lança erro para o chamador,
 * já que é enriquecimento, não uma operação crítica do CRUD do projeto.
 *
 * Gate de visibilidade: só entra na base um projeto com
 * `review_status = 'PUBLICADO'` e não deletado — mesmo critério que a
 * home/`/projetos`/`/api/chat` já usam para decidir o que é público. Hoje
 * (2026-08-26) nada no app ainda seta `review_status` para `PUBLICADO`
 * automaticamente (lacuna pré-existente, fora do escopo desta etapa) — então,
 * até isso ser resolvido, nenhum projeto vai de fato aparecer na base. É o
 * comportamento certo (não vaza rascunho), só documentando a causa.
 */

import { ingerirDocumentoRag } from '@/lib/rag-publicacao';
import { cache } from '@/lib/cache';
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { getStatusLabel } from '@/lib/utils';
import { financiamentoDoProjeto, type EquipeDoProjeto } from '@/lib/projetos-equipe';
import { buscarEquipeDoProjeto } from '@/lib/projetos-equipe-db';
import { Prisma } from '@prisma/client';
import { createLogger } from '@/lib/logger';

const log = createLogger('projeto-sintetico');

const projetoComRelacoes = Prisma.validator<Prisma.ProjetoDefaultArgs>()({
  include: {
    tags: true,
    cursos: true,
    faq: { orderBy: { ordem: 'asc' } },
  },
});
type ProjetoComRelacoes = Prisma.ProjetoGetPayload<typeof projetoComRelacoes>;

function gerarTextoSintetico(projeto: ProjetoComRelacoes, equipe: EquipeDoProjeto): string {
  const linhas: string[] = [];

  linhas.push(`Projeto: ${projeto.nome}`);
  if (projeto.tipo) linhas.push(`Tipo: ${projeto.tipo}`);
  linhas.push(`Área: ${projeto.area}`);
  linhas.push(`Status: ${getStatusLabel(projeto.status)}`);
  linhas.push(`Coordenador: ${projeto.coordenador}${projeto.coordenadorEmail ? ` (${projeto.coordenadorEmail})` : ''}`);
  if (projeto.viceCoordenadorNome) {
    linhas.push(`Vice-coordenador: ${projeto.viceCoordenadorNome}${projeto.viceCoordenadorEmail ? ` (${projeto.viceCoordenadorEmail})` : ''}`);
  }

  // Equipe (das inscrições aceitas) e financiamento são os mesmos dados que a
  // página pública mostra junto ao resumo. Entram no documento para a IFizinha
  // conseguir responder "quem são os bolsistas deste projeto?" e "quem
  // financia o projeto?".
  if (equipe.bolsistas.length > 0) linhas.push(`Estudantes bolsistas: ${equipe.bolsistas.join(', ')}`);
  if (equipe.voluntarios.length > 0) linhas.push(`Estudantes voluntários: ${equipe.voluntarios.join(', ')}`);
  const financiamento = financiamentoDoProjeto(projeto);
  if (financiamento.length > 0) linhas.push(`Financiamento: ${financiamento.join(', ')}`);

  if (projeto.resumoCurto) linhas.push(`\nResumo: ${projeto.resumoCurto}`);
  if (projeto.descricao) linhas.push(`\nDescrição: ${projeto.descricao}`);
  if (projeto.objetivo) linhas.push(`\nObjetivo: ${projeto.objetivo}`);
  if (projeto.metodologia) linhas.push(`\nMetodologia: ${projeto.metodologia}`);
  if (projeto.resultadoEsperado) linhas.push(`\nResultado esperado: ${projeto.resultadoEsperado}`);
  if (projeto.publicoAlvo) linhas.push(`Público-alvo: ${projeto.publicoAlvo}`);
  if (projeto.localRealizacao) linhas.push(`Local de realização: ${projeto.localRealizacao}`);
  if (projeto.cargaHorariaSemanal) linhas.push(`Carga horária semanal: ${projeto.cargaHorariaSemanal}h`);
  if (projeto.dataInicio) linhas.push(`Início: ${projeto.dataInicio.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`);
  if (projeto.dataConclusao) linhas.push(`Conclusão prevista: ${projeto.dataConclusao.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`);

  linhas.push(`\nInscrições: ${projeto.inscricoes_abertas ? 'ABERTAS' : 'fechadas no momento'}`);
  if (projeto.inscricoes_abertas) {
    linhas.push(`Vagas bolsista: ${projeto.vagasBolsista}`);
    linhas.push(`Vagas voluntário: ${projeto.vagasVoluntario}`);
    if (projeto.inscricao_fim) linhas.push(`Prazo de inscrição: ${projeto.inscricao_fim.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`);
  }

  if (projeto.tags.length > 0) linhas.push(`\nTags: ${projeto.tags.map((t) => t.tag).join(', ')}`);
  if (projeto.cursos.length > 0) linhas.push(`Cursos relacionados: ${projeto.cursos.map((c) => c.curso).join(', ')}`);

  if (projeto.faq.length > 0) {
    linhas.push('\nPerguntas frequentes:');
    for (const f of projeto.faq) {
      linhas.push(`P: ${f.pergunta}\nR: ${f.resposta}`);
    }
  }

  const contatos: string[] = [];
  if (projeto.email) contatos.push(`e-mail: ${projeto.email}`);
  if (projeto.instagram) contatos.push(`Instagram: ${projeto.instagram}`);
  if (projeto.site) contatos.push(`site: ${projeto.site}`);
  if (contatos.length > 0) linhas.push(`\nContato: ${contatos.join(' | ')}`);

  return linhas.join('\n');
}

async function desativarDocumento(documentoId: string): Promise<void> {
  await prisma.documentoKb.update({ where: { id: documentoId }, data: { ativo: false } });
  cache.invalidate('chat:');
}

/**
 * Sincroniza o `DocumentoKb` sintético de um projeto com o estado atual dele
 * no banco. Chame depois de qualquer create/update em `Projeto` (admin,
 * professor, sync SUAP). Idempotente: se o texto gerado não mudou desde a
 * última sincronização, não gasta chamada nenhuma de IA/embedding.
 */
export async function sincronizarProjetoSintetico(projetoId: string): Promise<void> {
  try {
    const projeto = await prisma.projeto.findUnique({
      where: { id: projetoId },
      ...projetoComRelacoes,
    });
    if (!projeto) return;

    const existente = await prisma.documentoKb.findFirst({
      where: { tipo: 'projeto_sintetico', refId: projetoId, ativo: true },
    });

    const devEstarNaBase = projeto.review_status === 'PUBLICADO' && !projeto.deleted_at;

    if (!devEstarNaBase) {
      if (existente?.ativo) {
        await desativarDocumento(existente.id);
        log.info('Documento sintético desativado (projeto não está mais publicado)', { projetoId, documentoId: existente.id });
      }
      return;
    }

    const texto = gerarTextoSintetico(projeto, await buscarEquipeDoProjeto(projetoId));
    const hash = createHash('sha256').update(texto).digest('hex');

    if (existente && existente.hashArquivo === hash && existente.ativo && ['indexed', 'textual'].includes(existente.status)) {
      log.debug('Documento sintético sem mudanças, sincronização ignorada', { projetoId, documentoId: existente.id });
      return; // nada relevante mudou desde a última sincronização
    }

    const result = await ingerirDocumentoRag({ titulo: projeto.nome, conteudo: texto, tipo: 'projeto_sintetico',
      refId: projetoId, anteriorId: existente?.id, metadata: { source: 'projeto_sintetico', projetoId, projetoSlug: projeto.slug } });
    log.info('Projeto sintético sincronizado', { projetoId, documentoId: result.id, totalChunks: result.chunks });
  } catch (err) {
    log.error('Falha ao sincronizar projeto sintético', {
      projetoId,
      erro: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Remove o documento sintético de um projeto — chame quando o projeto for excluído de vez. */
export async function removerProjetoSintetico(projetoId: string): Promise<void> {
  await prisma.documentoKb
    .deleteMany({ where: { tipo: 'projeto_sintetico', refId: projetoId } })
    .catch((err) =>
      log.error('Falha ao remover documento do projeto', {
        projetoId,
        erro: err instanceof Error ? err.message : String(err),
      })
    );
}
