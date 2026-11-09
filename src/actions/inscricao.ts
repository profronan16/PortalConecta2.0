'use server';

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { enviarConfirmacaoInscricao } from '@/lib/email';
import { gerarProtocoloDaInscricao } from '@/lib/protocolo-inscricao';
import { rateLimitado, obterIpCliente } from '@/lib/rate-limit';
import { verificarTurnstile } from '@/lib/turnstile';
import { parsePerguntasExtra, validarRespostasExtraObrigatorias } from '@/lib/formulario-extra';
import {
  LIMITES, OPCOES, validarCampos, validarEmail, validarMapaDeRespostas, validarNumero,
  validarOpcao, validarTelefone, validarTexto, validarTextoOpcional,
} from '@/lib/validacao';
import { MENSAGENS } from '@/lib/mensagens';
import { fimDoDiaBrasil, inicioDoDiaBrasil } from '@/lib/datas';

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
  /**
   * ⚠️ ACHADO (2026-10-05): o formulário público pede "Gênero" como campo
   * OBRIGATÓRIO, mas `Inscricao` não tem essa coluna — o dado era descartado em
   * silêncio (o aluno informa e não fica registrado em lugar nenhum). Aqui ele
   * passou a ser VALIDADO (o cliente pode mandar qualquer coisa), mas continua
   * não sendo gravado: ou o campo entra no banco, ou sai do formulário.
   */
  genero?: string;
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
// A partir do MAIOR protocolo do ano (e não da contagem, que repete número
// quando alguma inscrição foi apagada): ver lib/protocolo-inscricao.ts.
const gerarProtocolo = gerarProtocoloDaInscricao;

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

  if (!projeto) {
    return {
      aberto: false,
      erro: 'Não encontramos este projeto. Ele pode ter sido removido ou o link está incompleto.',
    };
  }
  if (projeto.status !== 'INSCRICOES_ABERTAS') {
    return {
      aberto: false,
      erro: 'As inscrições deste projeto não estão abertas neste momento. Volte à página de projetos para ver o que está com vagas abertas.',
    };
  }

  const agora = new Date();
  // Prazo INCLUSIVO e no fuso do Brasil: quem escolhe "encerra em 10/10" aceita
  // inscrição até 23:59 de 10/10 em Brasília. Antes, a data gravada ao
  // meio-dia UTC fazia o prazo terminar no meio da tarde do dia anterior.
  if (projeto.inscricao_inicio && agora < inicioDoDiaBrasil(projeto.inscricao_inicio)) {
    return {
      aberto: false,
      erro: 'As inscrições deste projeto ainda não começaram. Volte na data de abertura para se inscrever.',
    };
  }
  if (projeto.inscricao_fim && agora > fimDoDiaBrasil(projeto.inscricao_fim)) {
    return {
      aberto: false,
      erro: 'O prazo de inscrições deste projeto já encerrou. Confira outros projetos com inscrições abertas.',
    };
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
      return { ok: false, error: MENSAGENS.muitasInscricoes };
    }

    // CAPTCHA (Cloudflare Turnstile) — sem TURNSTILE_SECRET_KEY configurada,
    // `verificarTurnstile` sempre retorna true (degrada graciosamente).
    const captchaOk = await verificarTurnstile(data.captchaToken, ip);
    if (!captchaOk) {
      return { ok: false, error: MENSAGENS.verificacaoSegurancaFalhou };
    }

    // Validações
    if (!data.ciencia_regras) {
      return {
        ok: false,
        error: 'Para se inscrever, marque a caixinha confirmando que você leu e concorda com as regras do projeto.',
      };
    }
    if (!data.consentimento_lgpd) {
      return {
        ok: false,
        error: 'Para se inscrever, autorize o uso dos seus dados pessoais (LGPD — Lei Geral de Proteção de Dados). Marque a caixinha correspondente.',
      };
    }

    // ── Validação de entrada (este formulário é PÚBLICO: quem chama a Server
    // Action direto não passa pela validação do navegador) ──────────────────
    const v = validarCampos({
      nome: () => validarTexto(data.nome_completo, 'Nome completo', { min: 2, max: LIMITES.titulo.max }),
      email: () => validarEmail(data.email, 'E-mail'),
      telefone: () => validarTelefone(data.telefone),
      idade: () => validarNumero(data.idade, 'Idade', LIMITES.idade, { inteiro: true, opcional: true }),
      curso: () => validarTextoOpcional(data.curso, 'Curso', LIMITES.linha),
      turma: () => validarTextoOpcional(data.turma, 'Turma', { min: 0, max: 40 }),
      semestre: () => validarTextoOpcional(data.semestre, 'Semestre', { min: 0, max: 20 }),
      matricula: () => validarTextoOpcional(data.matricula, 'Matrícula', { min: 0, max: LIMITES.matricula }),
      disponibilidade: () => validarTextoOpcional(data.disponibilidade, 'Disponibilidade', LIMITES.resumo),
      experiencia: () => validarTextoOpcional(data.experiencia_previa, 'Experiência prévia', { min: 0, max: 40 }),
      justificativa: () => validarTextoOpcional(data.justificativa, 'Justificativa', LIMITES.texto),
      tipoInteresse: () => validarOpcao(data.tipo_interesse, 'Tipo de interesse', OPCOES.tipoInteresse),
      genero: () => validarOpcao(data.genero, 'Gênero', OPCOES.genero),
      camposExtra: () => validarMapaDeRespostas(data.campos_extra, 'Respostas do formulário'),
      consentimentoLgpd: () => (data.consentimento_lgpd === true
        ? { ok: true as const, valor: true }
        : { ok: false as const, error: 'É necessário aceitar o tratamento de dados (LGPD) para enviar a inscrição.' }),
    });
    if (!v.ok) return v;

    const nome = v.valor.nome;
    const email = v.valor.email;
    const telefone = v.valor.telefone;

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
    let tipoInteresse = v.valor.tipoInteresse;
    if (data.vagaId) {
      const vagaEscolhida = verificacao.projeto!.vagas.find((v) => v.id === data.vagaId);
      if (!vagaEscolhida) {
        return {
          ok: false,
          error: 'A vaga que você escolheu não está mais disponível para este projeto. Selecione outra vaga e envie novamente.',
        };
      }
      tipoInteresse = vagaEscolhida.tipo;
    }

    // Verificar se já existe inscrição deste email neste projeto (sem diferenciar
    // maiúsculas: "Maria@..." e "maria@..." são a mesma pessoa)
    const existente = await prisma.inscricao.findFirst({
      where: {
        projeto_id: data.projetoId,
        email: { equals: email, mode: 'insensitive' },
      },
    });

    if (existente) {
      return {
        ok: false,
        error: 'Você já tem uma inscrição neste projeto. Acompanhe o andamento em "Meus Dados".',
      };
    }

    // Gerar protocolo único
    const protocolo = await gerarProtocolo();

    // Criar inscrição — todos os campos abaixo já passaram pela validação de
    // entrada (tamanho, faixa numérica, formato) no bloco `validarCampos`.
    const inscricao = await prisma.inscricao.create({
      data: {
        protocolo,
        projeto_id: data.projetoId,
        vaga_id: data.vagaId || null,
        user_id: data.userId || null,
        nome_completo: nome,
        email,
        telefone: telefone || null,
        curso: v.valor.curso,
        turma: v.valor.turma,
        semestre: v.valor.semestre,
        idade: v.valor.idade,
        matricula: v.valor.matricula,
        tipo_interesse: tipoInteresse,
        disponibilidade: v.valor.disponibilidade,
        experiencia_previa: v.valor.experiencia,
        justificativa: v.valor.justificativa,
        ciencia_regras: data.ciencia_regras,
        consentimento_lgpd: v.valor.consentimentoLgpd,
        campos_extra: v.valor.camposExtra as Prisma.InputJsonValue,
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
      return { ok: false, error: MENSAGENS.sessaoInvalida };
    }
    return {
      ok: false,
      error: 'Não conseguimos registrar sua inscrição por um problema do nosso lado. Tente novamente — se continuar, fale com a coordenação do projeto.',
    };
  }
}
