import { describe, it, expect } from 'vitest';
import {
  acrescentarObservacao,
  decidirConvite,
  ehTipoDeConvite,
  observacaoDoConvite,
  termoDeBuscaValido,
  vagaCombinaComOPapel,
} from '@/lib/convite-estudante';
import { equipeDasInscricoes } from '@/lib/projetos-equipe';

describe('decidirConvite', () => {
  it('sem inscrição: cria; confirmação pendente deixa a resposta vazia', () => {
    expect(decidirConvite(null, true)).toEqual({ acao: 'criar', respostaAluno: null });
  });

  it('sem inscrição e sem pedir confirmação: já nasce aceita', () => {
    expect(decidirConvite(null, false)).toEqual({ acao: 'criar', respostaAluno: 'aceito' });
  });

  it('quem já está na equipe não é convidado de novo', () => {
    const existente = { status: 'selecionado', resposta_aluno: 'aceito' };
    expect(decidirConvite(existente, true)).toEqual({ acao: 'recusar', motivo: 'ja_na_equipe' });
    expect(decidirConvite(existente, false)).toEqual({ acao: 'recusar', motivo: 'ja_na_equipe' });
  });

  it('convite pendente: repetir o pedido é bloqueado, aceitar direto converte', () => {
    const pendente = { status: 'selecionado', resposta_aluno: null };
    expect(decidirConvite(pendente, true)).toEqual({ acao: 'recusar', motivo: 'ja_convidado' });
    expect(decidirConvite(pendente, false)).toEqual({ acao: 'atualizar', respostaAluno: 'aceito' });
  });

  it.each(['recebida', 'em_analise', 'lista_espera', 'nao_selecionado', 'desistente'])(
    'inscrição em "%s" é reaproveitada ao convidar',
    (status) => {
      expect(decidirConvite({ status, resposta_aluno: null }, true)).toEqual({
        acao: 'atualizar',
        respostaAluno: null,
      });
    },
  );

  it('quem recusou antes pode ser convidado de novo (a resposta é zerada)', () => {
    const recusada = { status: 'desistente', resposta_aluno: 'recusado' };
    expect(decidirConvite(recusada, true)).toEqual({ acao: 'atualizar', respostaAluno: null });
    expect(decidirConvite(recusada, false)).toEqual({ acao: 'atualizar', respostaAluno: 'aceito' });
  });
});

describe('convite aceito direto entra na equipe pública', () => {
  const base = { nome_completo: 'Ana Souza', status: 'selecionado', vaga: null };

  it('aceito direto aparece como voluntário ou bolsista conforme o papel escolhido', () => {
    const equipe = equipeDasInscricoes([
      { ...base, resposta_aluno: 'aceito', tipo_interesse: 'VOLUNTARIO' },
      { ...base, nome_completo: 'Bia Lima', resposta_aluno: 'aceito', tipo_interesse: 'BOLSISTA' },
    ]);
    expect(equipe.voluntarios).toEqual(['Ana Souza']);
    expect(equipe.bolsistas).toEqual(['Bia Lima']);
  });

  it('convite aguardando confirmação ainda NÃO aparece na equipe', () => {
    const equipe = equipeDasInscricoes([
      { ...base, resposta_aluno: null, tipo_interesse: 'VOLUNTARIO' },
    ]);
    expect(equipe.total).toBe(0);
  });
});

describe('vagaCombinaComOPapel', () => {
  it('vaga AMBOS serve para os dois papéis', () => {
    expect(vagaCombinaComOPapel('AMBOS', 'BOLSISTA')).toBe(true);
    expect(vagaCombinaComOPapel('AMBOS', 'VOLUNTARIO')).toBe(true);
  });
  it('vaga específica só combina com o próprio papel', () => {
    expect(vagaCombinaComOPapel('BOLSISTA', 'BOLSISTA')).toBe(true);
    expect(vagaCombinaComOPapel('BOLSISTA', 'VOLUNTARIO')).toBe(false);
    expect(vagaCombinaComOPapel('VOLUNTARIO', 'BOLSISTA')).toBe(false);
  });
});

describe('termoDeBuscaValido / ehTipoDeConvite', () => {
  it('exige 3 letras e limpa espaços', () => {
    expect(termoDeBuscaValido('ab')).toBeNull();
    expect(termoDeBuscaValido('  an  ')).toBeNull();
    expect(termoDeBuscaValido('  Ana   Souza ')).toBe('Ana Souza');
    expect(termoDeBuscaValido(42)).toBeNull();
  });
  it('só aceita Bolsista e Voluntário (não "AMBOS" nem lixo)', () => {
    expect(ehTipoDeConvite('BOLSISTA')).toBe(true);
    expect(ehTipoDeConvite('VOLUNTARIO')).toBe(true);
    expect(ehTipoDeConvite('AMBOS')).toBe(false);
    expect(ehTipoDeConvite(undefined)).toBe(false);
  });
});

describe('observação do convite', () => {
  it('registra papel, data, autor e se pediu confirmação', () => {
    expect(
      observacaoDoConvite({ pedirConfirmacao: true, tipo: 'BOLSISTA', por: 'prof@ifpr.edu.br', dataBr: '09/11/2026' }),
    ).toBe(
      'Convite da coordenação (Bolsista) em 09/11/2026 por prof@ifpr.edu.br: aguardando confirmação do estudante.',
    );
    expect(
      observacaoDoConvite({ pedirConfirmacao: false, tipo: 'VOLUNTARIO', por: 'p@x', dataBr: '09/11/2026' }),
    ).toContain('adicionado direto à equipe');
  });
  it('preserva a observação anterior', () => {
    expect(acrescentarObservacao('antes', 'novo')).toBe('antes\nnovo');
    expect(acrescentarObservacao(null, 'novo')).toBe('novo');
  });
});

import { destinoAoRemoverDaEquipe, ehConviteSemHistorico } from '@/lib/convite-estudante';

describe('destinoAoRemoverDaEquipe', () => {
  const soConvite = {
    resposta_aluno: null,
    observacao_interna: 'Convite da coordenação (Voluntário) em 09/11/2026 por a@b: aguardando confirmação do estudante.',
    justificativa: null,
    ciencia_regras: false,
    consentimento_lgpd: false,
  };

  it('inscrição que só existe pelo convite é apagada (convite pendente ou aceito direto)', () => {
    expect(destinoAoRemoverDaEquipe(soConvite)).toEqual({ acao: 'excluir' });
    expect(destinoAoRemoverDaEquipe({ ...soConvite, resposta_aluno: 'aceito' })).toEqual({ acao: 'excluir' });
  });

  it('quem se inscreveu de verdade nunca é apagado', () => {
    const real = { ...soConvite, observacao_interna: null, justificativa: 'quero participar', ciencia_regras: true, consentimento_lgpd: true };
    expect(ehConviteSemHistorico(real)).toBe(false);
    expect(destinoAoRemoverDaEquipe(real)).toEqual({ acao: 'mudar_status', status: 'em_analise' });
    expect(destinoAoRemoverDaEquipe({ ...real, resposta_aluno: 'aceito' })).toEqual({
      acao: 'mudar_status',
      status: 'nao_selecionado',
    });
  });

  it('convite com histórico (reconvite, anotação a mais) é preservado', () => {
    expect(
      ehConviteSemHistorico({ ...soConvite, observacao_interna: `${soConvite.observacao_interna}\nOutra anotação.` }),
    ).toBe(false);
  });
});
