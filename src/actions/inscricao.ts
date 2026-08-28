'use server';

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { enviarConfirmacaoInscricao } from '@/lib/email';
import { rateLimitado, obterIpCliente } from '@/lib/rate-limit';
import { verificarTurnstile } from '@/lib/turnstile';
import { parsePerguntasExtra, validarRespostasExtraObrigatorias } from '@/lib/formulario-extra';

type InscricaoFormData = {
  projetoId: string;
  vagaId?: string;
  nome_completo: string;
  email: string;
  telefone?: string;
  curso?: string;
  turma?: string;
  semestre?: string;
  idade?: number;
  matricula?: string;
  tipo_interesse: 'BOLSISTA' | 'VOLUNTARIO' | 'AMBOS';
  disponibilidade?: string;
  experiencia_previa?: string;
  justificativa?: string;
  ciencia_regras: boolean;
  consentimento_lgpd: boolean;
  campos_extra?: Record<string, unknown>;
  userId?: string;
  captchaToken?: string;
};

type ActionResult = { ok: true; data: { protocolo: string } } | { ok: false; error: string };

/**
 * Gera protocolo único: PRJ-YYYY-NNNNNN
 */
async function gerarProtocolo(): Promise<string> {
  const ano = new Date().getFullYear();
  const count = await prisma.inscricao.count({
    where: {
      protocolo: { startsWith: `PRJ-${ano}-` },
    },
  });
  const num = (count + 1).toString().padStart(6, '0');
  return `PRJ-${ano}-${num}`;
}

/**
 * Verifica se o projeto aceita inscrições
 */
export async function verificarInscricoesAbertas(projetoId: string) {
  const projeto = await prisma.projeto.findUnique({
    where: { id: projetoId },
    select: {
      id: true,
      nome: true,
      status: true,
      inscricao_inicio: true,
      inscricao_fim: true,
      vagasBolsista: true,
      vagasVoluntario: true,
      formulario_extra: true,
      vagas: {
        where: { status: 'ABERTA' },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!projeto) return { aberto: false, erro: 'Projeto não encontrado' };
  if (projeto.status !== 'INSCRICOES_ABERTAS') {
    return { aberto: false, erro: 'Inscrições não estão abertas para este projeto' };
  }

  const agora = new Date();
  if (projeto.inscricao_inicio && agora < projeto.inscricao_inicio) {
    return { aberto: false, erro: 'Inscrições ainda não iniciaram' };
  }
  if (projeto.inscricao_fim && agora > projeto.inscricao_fim) {
    return { aberto: false, erro: 'Prazo de inscrições encerrado' };
  }

  return { aberto: true, projeto };
}

/**
 * Cria inscrição
 */
export async function criarInscricao(data: InscricaoFormData): Promise<ActionResult> {
  try {
    // Rate limit por IP — formulário público, alvo natural de spam (achado
    // S13 do RELATORIO_TESTES.md). 10 inscrições / 10 minutos por IP, o
    // suficiente pra alguém se inscrever em vários projetos legítimos sem
    // travar, mas barra um script mandando dezenas em sequência.
    const ip = obterIpCliente();
    const limite = await rateLimitado('criar-inscricao', ip, 10, 10 * 60_000);
    if (!limite.ok) {
      return { ok: false, error: 'Muitas inscrições em pouco tempo. Aguarde alguns minutos e tente novamente.' };
    }

    // CAPTCHA (Cloudflare Turnstile) — sem TURNSTILE_SECRET_KEY configurada,
    // `verificarTurnstile` sempre retorna true (degrada graciosamente).
    const captchaOk = await verificarTurnstile(data.captchaToken, ip);
    if (!captchaOk) {
      return { ok: false, error: 'Verificação de segurança falhou. Recarregue a página e tente novamente.' };
    }

    // Validações
    if (!data.ciencia_regras) {
      return { ok: false, error: 'Você precisa ciência das regras para se inscrever' };
    }
    if (!data.consentimento_lgpd) {
      return { ok: false, error: 'Consentimento LGPD é obrigatório' };
    }

    // Trim e validação de campos obrigatórios
    const nome = data.nome_completo?.trim();
    const email = data.email?.trim();
    if (!nome || nome.length < 2) {
      return { ok: false, error: 'Nome completo é obrigatório (mínimo 2 caracteres)' };
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: 'Email inválido' };
    }

    // Valid idade se fornecida
    if (data.idade !== undefined && data.idade !== null) {
      if (data.idade < 14 || data.idade > 100) {
        return { ok: false, error: 'Idade deve ser entre 14 e 100 anos' };
      }
    }

    // Telefone, se fornecido: só dígitos, espaços, parênteses, hífen e "+" —
    // 8 a 15 dígitos (formatos nacionais e internacionais razoáveis).
    const telefone = data.telefone?.trim();
    if (telefone) {
      const digitos = telefone.replace(/\D/g, '');
      if (!/^[\d\s()+-]+$/.test(telefone) || digitos.length < 8 || digitos.length > 15) {
        return { ok: false, error: 'Telefone inválido' };
      }
    }

    // Verificar se projeto aceita inscrições
    const verificacao = await verificarInscricoesAbertas(data.projetoId);
    if (!verificacao.aberto) {
      return { ok: false, error: verificacao.erro! };
    }

    // Perguntas extras obrigatórias definidas pelo coordenador — o form
    // público já marca `required`, mas isso é só client-side; o servidor
    // não pode confiar que o navegador de fato validou.
    const perguntasExtra = parsePerguntasExtra(verificacao.projeto!.formulario_extra);
    const erroExtra = validarRespostasExtraObrigatorias(perguntasExtra, data.campos_extra ?? {});
    if (erroExtra) {
      return { ok: false, error: erroExtra };
    }

    // Se uma vaga específica foi escolhida, validar que ela pertence a este
    // projeto e está aberta — o tipo de interesse passa a ser o da própria vaga.
    let tipoInteresse = data.tipo_interesse;
    if (data.vagaId) {
      const vagaEscolhida = verificacao.projeto!.vagas.find((v) => v.id === data.vagaId);
      if (!vagaEscolhida) {
        return { ok: false, error: 'Vaga selecionada não está mais disponível para este projeto' };
      }
      tipoInteresse = vagaEscolhida.tipo;
    }

    // Verificar se já existe inscrição deste email neste projeto
    const existente = await prisma.inscricao.findFirst({
      where: {
        projeto_id: data.projetoId,
        email: data.email,
      },
    });

    if (existente) {
      return { ok: false, error: 'Você já está inscrito neste projeto' };
    }

    // Gerar protocolo único
    const protocolo = await gerarProtocolo();

    // Criar inscrição
    const inscricao = await prisma.inscricao.create({
      data: {
        protocolo,
        projeto_id: data.projetoId,
        vaga_id: data.vagaId || null,
        user_id: data.userId || null,
        nome_completo: nome,
        email,
        telefone: data.telefone?.trim() || null,
        curso: data.curso || null,
        turma: data.turma || null,
        semestre: data.semestre || null,
        idade: data.idade || null,
        matricula: data.matricula?.trim() || null,
        tipo_interesse: tipoInteresse,
        disponibilidade: data.disponibilidade || null,
        experiencia_previa: data.experiencia_previa || null,
        justificativa: data.justificativa?.trim() || null,
        ciencia_regras: data.ciencia_regras,
        consentimento_lgpd: data.consentimento_lgpd,
        campos_extra: (data.campos_extra ?? {}) as Prisma.InputJsonValue,
        status: 'recebida',
      },
    });

    // Enviar e-mail de confirmação (não bloqueia a resposta)
    enviarConfirmacaoInscricao({
      protocolo: inscricao.protocolo,
      nomeCompleto: data.nome_completo,
      email: data.email,
      projetoNome: verificacao.projeto!.nome,
      tipoInteresse: tipoInteresse,
    }).catch(console.error);

    return { ok: true, data: { protocolo: inscricao.protocolo } };
  } catch (e) {
    console.error('Erro ao criar inscrição:', e);
    // Achado real: `userId` inválido (não corresponde a nenhum User.id)
    // já causou esse erro em produção — mensagem específica pra facilitar
    // diagnóstico, em vez do genérico de sempre escondendo a causa.
    if (String(e).includes('Inscricao_user_id_fkey')) {
      return { ok: false, error: 'Sua sessão parece inválida. Saia e entre novamente antes de se inscrever.' };
    }
    return { ok: false, error: 'Erro interno ao processar inscrição' };
  }
}
