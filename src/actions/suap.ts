'use server';

/**
 * Server Actions para integração com SUAP
 * Executam no servidor — credenciais ficam protegidas no .env.local
 */

import { syncProjetos, syncEditais, getLastSyncLogs } from '@/lib/suap-sync';
import { testSuapConnection, fetchSuapEndpoints } from '@/lib/suap-api';
import { prisma } from '@/lib/prisma';
import { isAdministradorGeral } from '@/lib/permissions';

// ─── Sync Actions ──────────────────────────────────────────────────────────────
//
// Carregar/atualizar dados direto do SUAP é exclusivo do Administrador Geral
// (achado equivalente ao S1/S2 do RELATORIO_TESTES.md em outras actions: até
// aqui, syncProjetosAction/syncEditaisAction não tinham NENHUMA checagem de
// autorização — a página só escondia o botão na UI para quem não era master,
// mas a Server Action em si podia ser chamada diretamente por qualquer um).

export async function syncProjetosAction(dryRun = false, callerEmail?: string, forcar = false) {
  if (!callerEmail || !isAdministradorGeral(callerEmail)) {
    return {
      total: 0, criados: 0, atualizados: 0, preservados: 0, erros: 1,
      detalhes: ['❌ Acesso negado: apenas o Administrador Geral pode sincronizar com o SUAP'],
    };
  }
  try {
    return await syncProjetos({ dryRun, forcar });
  } catch (err) {
    return {
      total: 0, criados: 0, atualizados: 0, preservados: 0, erros: 1,
      detalhes: [`❌ ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

export async function syncEditaisAction(dryRun = false, callerEmail?: string, forcar = false) {
  if (!callerEmail || !isAdministradorGeral(callerEmail)) {
    return {
      total: 0, criados: 0, atualizados: 0, preservados: 0, erros: 1,
      detalhes: ['❌ Acesso negado: apenas o Administrador Geral pode sincronizar com o SUAP'],
    };
  }
  try {
    return await syncEditais({ dryRun, forcar });
  } catch (err) {
    return {
      total: 0, criados: 0, atualizados: 0, preservados: 0, erros: 1,
      detalhes: [`❌ ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

// ─── Status Action ─────────────────────────────────────────────────────────────

export async function getSuapStatusAction(callerEmail?: string) {
  if (!callerEmail || !isAdministradorGeral(callerEmail)) {
    return {
      suap: {
        configurado: false,
        temApiToken: false,
        temUserPass: false,
        temClientCredentials: false,
        baseUrl: process.env.SUAP_BASE_URL ?? 'https://suap.ifpr.edu.br',
        campus: process.env.SUAP_CAMPUS ?? 'Ivaiporã',
        conexao: { ok: false, message: 'Acesso negado: apenas o Administrador Geral pode ver o status do SUAP' },
      },
      banco: { totalProjetos: 0, totalEditais: 0, projetosDoSuap: 0, editaisDoSuap: 0 },
      logs: [],
    };
  }

  const [conexao, logs, totalProjetos, totalEditais, projetosDoSuap, editaisDoSuap] =
    await Promise.allSettled([
      testSuapConnection(),
      getLastSyncLogs(20),
      prisma.projeto.count(),
      prisma.edital.count(),
      prisma.projeto.count({ where: { suapId: { not: null } } }),
      prisma.edital.count({ where: { suapId: { not: null } } }),
    ]);

  // Considera configurado se tiver qualquer método de auth válido
  const temApiToken = !!(
    process.env.SUAP_API_TOKEN &&
    process.env.SUAP_API_TOKEN !== 'cole-seu-token-pessoal-aqui'
  );
  const temUserPass = !!(
    process.env.SUAP_USERNAME &&
    process.env.SUAP_PASSWORD &&
    process.env.SUAP_PASSWORD !== 'sua-senha-suap-aqui'
  );
  const temClientCredentials = !!(process.env.SUAP_CLIENT_ID && process.env.SUAP_CLIENT_SECRET);

  return {
    suap: {
      configurado: temApiToken || temUserPass || temClientCredentials,
      temApiToken,
      temUserPass,
      temClientCredentials,
      baseUrl: process.env.SUAP_BASE_URL ?? 'https://suap.ifpr.edu.br',
      campus: process.env.SUAP_CAMPUS ?? 'Ivaiporã',
      conexao: conexao.status === 'fulfilled'
        ? conexao.value
        : { ok: false, message: String(conexao.reason) },
    },
    banco: {
      totalProjetos: totalProjetos.status === 'fulfilled' ? totalProjetos.value : 0,
      totalEditais: totalEditais.status === 'fulfilled' ? totalEditais.value : 0,
      projetosDoSuap: projetosDoSuap.status === 'fulfilled' ? projetosDoSuap.value : 0,
      editaisDoSuap: editaisDoSuap.status === 'fulfilled' ? editaisDoSuap.value : 0,
    },
    logs: logs.status === 'fulfilled' ? logs.value : [],
  };
}

// ─── Explorar endpoints ────────────────────────────────────────────────────────

export async function getSuapEndpointsAction(callerEmail?: string) {
  if (!callerEmail || !isAdministradorGeral(callerEmail)) {
    return { error: 'Acesso negado: apenas o Administrador Geral' };
  }
  try {
    return await fetchSuapEndpoints();
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
