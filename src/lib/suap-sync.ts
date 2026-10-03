/**
 * SUAP Sync — mapeia dados da API SUAP para o banco local (Prisma/PostgreSQL)
 *
 * Fluxo:
 *  1. Busca dados da API SUAP (suap-api.ts)
 *  2. Mapeia campos SUAP → nosso schema
 *  3. Faz upsert no banco (create ou update pelo suapId)
 *  4. Grava log de sincronização
 */

import { prisma } from '@/lib/prisma';
import { cache } from '@/lib/cache';
import { sincronizarProjetoSintetico } from '@/lib/projeto-sintetico';
import {
  decidirAtualizacaoSync,
  foiEditadoAposSync,
  mensagemPreservado,
} from '@/lib/suap-edicao-manual';
import { suapIdUnico } from '@/lib/suap-identidade';
import {
  fetchProjetosFromSuap,
  fetchEditaisFromSuap,
  mapStatusProjeto,
  mapCategoriaEdital,
  type SuapProjeto,
  type SuapEdital,
} from '@/lib/suap-api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .trim()
    .slice(0, 100);
}

/** Gera slug único adicionando sufixo numérico se necessário */
async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  let slug = slugify(base);
  let n = 0;

  while (true) {
    const candidate = n === 0 ? slug : `${slug}-${n}`;
    const existing = await prisma.projeto.findFirst({
      where: { slug: candidate, NOT: excludeId ? { id: excludeId } : undefined },
    });
    if (!existing) return candidate;
    n++;
  }
}

async function uniqueEditalSlug(base: string, excludeId?: string): Promise<string> {
  let slug = slugify(base);
  let n = 0;

  while (true) {
    const candidate = n === 0 ? slug : `${slug}-${n}`;
    const existing = await prisma.edital.findFirst({
      where: { slug: candidate, NOT: excludeId ? { id: excludeId } : undefined },
    });
    if (!existing) return candidate;
    n++;
  }
}

function parseDateSafe(dateStr?: string | null): Date | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// extrairParticipantes removido — API atual não retorna equipe detalhada

// ─── Sync Projetos ─────────────────────────────────────────────────────────────

export interface SyncResult {
  total: number;
  criados: number;
  atualizados: number;
  /**
   * Registros que JÁ existem no portal mas foram editados manualmente depois do
   * último sync e por isso NÃO foram sobrescritos (ROADMAP 5.5).
   */
  preservados: number;
  erros: number;
  detalhes: string[];
  dadosBrutos?: unknown; // raw SUAP response para debug
}

export async function syncProjetos(options?: { dryRun?: boolean; forcar?: boolean }): Promise<SyncResult> {
  const result: SyncResult = { total: 0, criados: 0, atualizados: 0, preservados: 0, erros: 0, detalhes: [] };

  let projetosSuap: SuapProjeto[] = [];

  try {
    const { projetos, avisos } = await fetchProjetosFromSuap();
    projetosSuap = projetos;
    result.total = projetosSuap.length;
    result.dadosBrutos = projetosSuap.slice(0, 3); // primeiros 3 para debug
    result.detalhes.push(`✅ ${projetosSuap.length} projetos encontrados no SUAP (campus ${process.env.SUAP_CAMPUS_SIGLA ?? 'IVAIPODG'})`);
    result.detalhes.push(...avisos);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.erros++;
    result.detalhes.push(`❌ Erro ao buscar projetos: ${msg}`);
    await logSync('projetos', 'error', result);
    return result;
  }

  if (options?.dryRun) {
    result.detalhes.push('🔍 Modo dry-run — nenhum dado foi salvo');
    return result;
  }

  for (const sp of projetosSuap) {
    try {
      // ── Mapear campos reais da API ──
      const nome = sp.titulo ?? `Projeto SUAP #${sp.id}`;
      const status = mapStatusProjeto(sp.situacao);

      // Área baseada na fonte (pesquisa ou extensão)
      const area = sp._fonte === 'pesquisa' ? 'Pesquisa' : 'Extensão';

      // ── Verificar se já existe pelo suapId ──
      // IDs podem colidir entre pesquisa e extensão — a chave única é derivada
      // da fonte + id (ver src/lib/suap-identidade.ts) e é ela que garante a
      // idempotência: rodar o sync duas vezes atualiza, não duplica.
      const suapIdLocal = suapIdUnico(sp._fonte, sp.id);

      const existente = await prisma.projeto.findUnique({
        where: { suapId: suapIdLocal },
      });

      const slug = existente
        ? existente.slug
        : await uniqueSlug(`${sp._fonte ?? 'projeto'}-${nome}`);

      const data = {
        suapId: suapIdLocal,
        suapSyncedAt: new Date(),
        nome,
        slug,
        coordenador: sp.nome_coordenador ?? 'Não informado',
        coordenadorEmail: sp.email_coordenador ?? null,
        coordenadorMatricula: null,
        area,
        descricao: sp.resumo ?? null,
        objetivo: null,
        metodologia: null,
        resultadoEsperado: null,
        dataInicio: parseDateSafe(sp.dt_inicio),
        dataConclusao: parseDateSafe(sp.dt_final),
        servidores: null,
        alunos: null,
        status: status as 'ATIVO' | 'EM_EXECUCAO' | 'ENCERRADO' | 'SUSPENSO' | 'INSCRICOES_ABERTAS' | 'SEM_VAGAS',
      };

      if (existente) {
        // ROADMAP 5.5: se o registro foi editado no portal depois do último
        // sync, não sobrescrevemos — o relatório avisa e o admin decide se
        // dispara uma sync forçada. `suapSyncedAt` de propósito NÃO é
        // atualizado nesse caminho: se fosse, a edição manual deixaria de ser
        // detectável no próximo sync e o dado seria perdido depois.
        const editadoManualmente = foiEditadoAposSync(existente);

        if (decidirAtualizacaoSync({ editadoManualmente, forcar: options?.forcar }) === 'preservar') {
          result.preservados++;
          result.detalhes.push(mensagemPreservado(existente.nome, sp.id));
          continue;
        }

        // Não seta review_status aqui: se um admin já revisou/despublicou
        // manualmente este projeto, um re-sync não deve sobrescrever essa
        // decisão silenciosamente.
        await prisma.projeto.update({ where: { suapId: suapIdLocal }, data });
        result.atualizados++;
        result.detalhes.push(`🔄 Atualizado: "${nome}" (SUAP ID: ${sp.id})`);
        await sincronizarProjetoSintetico(existente.id).catch(console.error);
      } else {
        // Projeto novo vindo do SUAP: publica direto — não existe hoje um
        // fluxo de moderação para o admin revisar antes (lacuna documentada
        // na Etapa 5/10 do plano RAG), então deixar em RASCUNHO faria o
        // projeto nunca aparecer em lugar nenhum do site.
        const criado = await prisma.projeto.create({ data: { ...data, review_status: 'PUBLICADO' } });
        result.criados++;
        result.detalhes.push(`➕ Criado: "${nome}" (SUAP ID: ${sp.id})`);
        await sincronizarProjetoSintetico(criado.id).catch(console.error);
      }
    } catch (err) {
      result.erros++;
      const msg = err instanceof Error ? err.message : String(err);
      result.detalhes.push(`❌ Erro em projeto SUAP #${sp.id}: ${msg}`);
    }
  }

  await logSync('projetos', result.erros === 0 ? 'success' : 'partial', result);
  cache.invalidate('chat:');
  return result;
}

// ─── Sync Editais ──────────────────────────────────────────────────────────────

export async function syncEditais(options?: { dryRun?: boolean; forcar?: boolean }): Promise<SyncResult> {
  // Buscar admin padrão para ser author dos editais
  const adminUser = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
  });

  if (!adminUser) {
    return {
      total: 0,
      criados: 0,
      atualizados: 0,
      preservados: 0,
      erros: 1,
      detalhes: ['❌ Nenhum usuário admin encontrado. Execute o seed primeiro.'],
    };
  }

  const result: SyncResult = { total: 0, criados: 0, atualizados: 0, preservados: 0, erros: 0, detalhes: [] };

  let editaisSuap: SuapEdital[] = [];

  try {
    editaisSuap = await fetchEditaisFromSuap();
    result.total = editaisSuap.length;
    result.dadosBrutos = editaisSuap.slice(0, 3);
    result.detalhes.push(`✅ ${editaisSuap.length} editais encontrados no SUAP`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.erros++;
    result.detalhes.push(`❌ Erro ao buscar editais: ${msg}`);
    await logSync('editais', 'error', result);
    return result;
  }

  if (options?.dryRun) {
    result.detalhes.push('🔍 Modo dry-run — nenhum dado foi salvo');
    return result;
  }

  for (const se of editaisSuap) {
    try {
      const titulo = se.titulo ?? `Edital SUAP #${se.id}`;
      const categoria = mapCategoriaEdital(se.tipo ?? se.titulo);

      const dataEncerramento =
        parseDateSafe(se.data_fim_inscricao) ??
        parseDateSafe(se.data_divulgacao_resultado) ??
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 dias como fallback

      const dataInicio = parseDateSafe(se.data_inicio_inscricao);
      const dataResultado = parseDateSafe(se.data_divulgacao_resultado);

      // Determinar status baseado nas datas
      const agora = new Date();
      const diasRestantes = Math.ceil(
        (dataEncerramento.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24)
      );

      let status: string;
      if (se.status) {
        const s = se.status.toLowerCase();
        if (s.includes('result') || s.includes('divulg')) status = 'RESULTADO_PUBLICADO';
        else if (s.includes('encerr') || s.includes('finaliz')) status = 'ENCERRADO';
        else if (diasRestantes <= 7) status = 'PRAZO_RECURSO';
        else status = 'ABERTO';
      } else if (diasRestantes < 0) {
        status = 'ENCERRADO';
      } else if (diasRestantes <= 7) {
        status = 'PRAZO_RECURSO';
      } else {
        status = 'ABERTO';
      }

      // Tradução IFizinha padrão (será enriquecida manualmente)
      const traducaoIFizinha = {
        oQueE: se.descricao ?? `Edital ${titulo} publicado pelo IFPR.`,
        quemPode: 'Consulte o edital oficial para verificar os critérios de participação.',
        comoParticipar:
          'Acesse o edital oficial e siga as instruções de inscrição indicadas no documento.',
        quando: dataEncerramento
          ? `Inscrições até ${dataEncerramento.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}.`
          : 'Consulte o edital oficial para as datas.',
        documentos: ['Consulte o edital oficial para a lista completa de documentos necessários.'],
        mensagemIfizinha:
          '⚠️ Esta tradução ainda não foi revisada pela IFizinha. Confira o edital oficial para todas as informações! ✅',
        revisada: false,
      };

      const existente = await prisma.edital.findUnique({
        where: { suapId: se.id },
      });

      const slug = existente
        ? existente.slug
        : await uniqueEditalSlug(titulo);

      const data = {
        suapId: se.id,
        suapSyncedAt: new Date(),
        titulo,
        slug,
        numero: se.numero ?? null,
        categoria: categoria as 'BOLSAS' | 'AUXILIOS' | 'EXTENSAO' | 'PESQUISA' | 'ENSINO' | 'EVENTOS' | 'ESTAGIOS' | 'RESULTADOS',
        resumo: se.descricao ?? `Edital publicado pelo IFPR Campus Ivaiporã. Acesse o link oficial para mais informações.`,
        dataInicio,
        dataEncerramento,
        dataResultado,
        status: status as 'EM_BREVE' | 'ABERTO' | 'EM_ANALISE' | 'RESULTADO_PARCIAL' | 'PRAZO_RECURSO' | 'RESULTADO_PUBLICADO' | 'ENCERRADO',
        traducaoIFizinha,
        arquivoPdfUrl: se.arquivo ?? null,
        linkOficial: se.link ?? `https://suap.ifpr.edu.br/api/v2/extensao/editais/${se.id}/`,
        authorId: adminUser.id,
      };

      if (existente) {
        // Mesma proteção dos projetos (ROADMAP 5.5): edital ajustado no portal
        // não é sobrescrito pelo sync sem uma sync forçada explícita.
        const editadoManualmente = foiEditadoAposSync(existente);

        if (decidirAtualizacaoSync({ editadoManualmente, forcar: options?.forcar }) === 'preservar') {
          result.preservados++;
          result.detalhes.push(mensagemPreservado(existente.titulo, se.id));
          continue;
        }

        // Não seta review_status aqui — preserva decisão manual de moderação
        // já feita por um admin (mesmo raciocínio de syncProjetos).
        await prisma.edital.update({ where: { suapId: se.id }, data });
        result.atualizados++;
        result.detalhes.push(`🔄 Atualizado: "${titulo}" (SUAP ID: ${se.id})`);
      } else {
        await prisma.edital.create({ data: { ...data, review_status: 'PUBLICADO' } });
        result.criados++;
        result.detalhes.push(`➕ Criado: "${titulo}" (SUAP ID: ${se.id})`);
      }
    } catch (err) {
      result.erros++;
      const msg = err instanceof Error ? err.message : String(err);
      result.detalhes.push(`❌ Erro em edital SUAP #${se.id}: ${msg}`);
    }
  }

  await logSync('editais', result.erros === 0 ? 'success' : 'partial', result);
  cache.invalidate('chat:');
  return result;
}

// ─── Log de sincronização ─────────────────────────────────────────────────────

async function logSync(tipo: string, status: string, result: SyncResult) {
  try {
    await prisma.syncLog.create({
      data: {
        tipo,
        status,
        totalSuap: result.total,
        sincronizados: result.criados + result.atualizados,
        erros: result.erros,
        mensagem: result.detalhes.join('\n'),
      },
    });
  } catch {
    // Não deixar falha no log quebrar a sync
    console.warn('Falha ao gravar SyncLog');
  }
}

/** Busca os últimos logs de sync */
export async function getLastSyncLogs(limit = 10) {
  return prisma.syncLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
