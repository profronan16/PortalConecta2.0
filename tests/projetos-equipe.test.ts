import { describe, it, expect } from 'vitest';
import {
  FINANCIAMENTOS_SUGERIDOS,
  LIMITES_EQUIPE,
  normalizarFinanciamento,
  normalizarViceCoordenacao,
  equipeDasInscricoes,
  inscricaoEstaNaEquipe,
  financiamentoDoProjeto,
  type InscricaoDaEquipe,
} from '@/lib/projetos-equipe';

/**
 * Equipe, financiamento e vice-coordenação do projeto.
 *
 * A equipe de estudantes é DERIVADA das inscrições (selecionado + aceitou a
 * convocação); financiamento e vice são campos que a coordenação edita. Estes
 * testes cobrem as regras que o SERVIDOR aplica (o formulário pode mandar
 * qualquer coisa: quem chama a Server Action direto não passa por ele).
 */

describe('FINANCIAMENTOS_SUGERIDOS', () => {
  it('traz as fontes pedidas pela coordenação, na ordem em que são exibidas', () => {
    expect(FINANCIAMENTOS_SUGERIDOS).toEqual([
      'IFPR',
      'CNPq',
      'Fundação Araucária',
      'Emenda Parlamentar',
    ]);
  });
});

describe('normalizarFinanciamento', () => {
  it('aceita fontes sugeridas e "afins" (o campo é livre)', () => {
    const r = normalizarFinanciamento(['IFPR', 'CNPq', 'Fundação Araucária', 'Emenda Parlamentar', 'PIBEX']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor).toHaveLength(5);
  });

  it('apara, descarta vazios e deduplica', () => {
    const r = normalizarFinanciamento([' CNPq ', '', 'CNPq', 'IFPR']);
    expect(r).toEqual({ ok: true, valor: ['CNPq', 'IFPR'] });
  });

  it('recusa mais fontes que o teto', () => {
    const fontes = Array.from({ length: LIMITES_EQUIPE.financiamento.maxItens + 1 }, (_, i) => `Fonte ${i}`);
    expect(normalizarFinanciamento(fontes).ok).toBe(false);
  });

  it('recusa valor que não é lista', () => {
    expect(normalizarFinanciamento('IFPR, CNPq').ok).toBe(false);
  });
});

describe('normalizarViceCoordenacao', () => {
  it('apara o nome e põe o e-mail em minúsculas (é ele que dá acesso ao painel)', () => {
    expect(
      normalizarViceCoordenacao({ viceCoordenadorNome: '  Maria Souza ', viceCoordenadorEmail: ' Maria@IFPR.edu.br ' }),
    ).toEqual({
      ok: true,
      valor: { viceCoordenadorNome: 'Maria Souza', viceCoordenadorEmail: 'maria@ifpr.edu.br' },
    });
  });

  it('vazio ou ausente vira "sem vice" (null), nunca string vazia', () => {
    const esperado = { ok: true, valor: { viceCoordenadorNome: null, viceCoordenadorEmail: null } };
    expect(normalizarViceCoordenacao({ viceCoordenadorNome: '  ', viceCoordenadorEmail: '' })).toEqual(esperado);
    expect(normalizarViceCoordenacao({})).toEqual(esperado);
  });

  it('recusa e-mail inválido, com o nome do campo na mensagem', () => {
    const r = normalizarViceCoordenacao({ viceCoordenadorNome: 'Maria', viceCoordenadorEmail: 'maria@' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('vice-coordenador');
  });

  it('recusa valor que não é texto', () => {
    expect(normalizarViceCoordenacao({ viceCoordenadorNome: 42 }).ok).toBe(false);
    expect(normalizarViceCoordenacao({ viceCoordenadorEmail: 42 }).ok).toBe(false);
  });

  it('recusa nome acima do teto', () => {
    expect(normalizarViceCoordenacao({ viceCoordenadorNome: 'a'.repeat(500) }).ok).toBe(false);
  });
});

function inscricao(extra: Partial<InscricaoDaEquipe> & { nome_completo: string }): InscricaoDaEquipe {
  return {
    status: 'selecionado',
    resposta_aluno: 'aceito',
    tipo_interesse: 'VOLUNTARIO',
    vaga: null,
    ...extra,
  };
}

describe('inscricaoEstaNaEquipe', () => {
  it('só entra quem foi selecionado E aceitou a convocação', () => {
    expect(inscricaoEstaNaEquipe({ status: 'selecionado', resposta_aluno: 'aceito' })).toBe(true);
    // Selecionado, mas ainda não respondeu: não aparece publicamente.
    expect(inscricaoEstaNaEquipe({ status: 'selecionado', resposta_aluno: null })).toBe(false);
    expect(inscricaoEstaNaEquipe({ status: 'selecionado', resposta_aluno: 'recusado' })).toBe(false);
    // Aceitou, mas depois desistiu (resposta fica 'aceito', o status muda).
    expect(inscricaoEstaNaEquipe({ status: 'desistente', resposta_aluno: 'aceito' })).toBe(false);
    expect(inscricaoEstaNaEquipe({ status: 'recebida', resposta_aluno: null })).toBe(false);
  });
});

describe('equipeDasInscricoes', () => {
  it('separa bolsistas e voluntários e conta o total', () => {
    const equipe = equipeDasInscricoes([
      inscricao({ nome_completo: 'Ana', tipo_interesse: 'BOLSISTA' }),
      inscricao({ nome_completo: 'Bruno', tipo_interesse: 'BOLSISTA' }),
      inscricao({ nome_completo: 'Carla', tipo_interesse: 'VOLUNTARIO' }),
    ]);
    expect(equipe).toEqual({ bolsistas: ['Ana', 'Bruno'], voluntarios: ['Carla'], total: 3 });
  });

  it('ignora quem não aceitou, recusou ou desistiu', () => {
    const equipe = equipeDasInscricoes([
      inscricao({ nome_completo: 'Ana', tipo_interesse: 'BOLSISTA' }),
      inscricao({ nome_completo: 'Sem resposta', resposta_aluno: null }),
      inscricao({ nome_completo: 'Recusou', resposta_aluno: 'recusado', status: 'desistente' }),
      inscricao({ nome_completo: 'Desistiu', status: 'desistente' }),
      inscricao({ nome_completo: 'Em análise', status: 'em_analise', resposta_aluno: null }),
    ]);
    expect(equipe).toEqual({ bolsistas: ['Ana'], voluntarios: [], total: 1 });
  });

  it('o tipo da vaga manda sobre o interesse marcado na inscrição', () => {
    const equipe = equipeDasInscricoes([
      inscricao({ nome_completo: 'Ana', tipo_interesse: 'VOLUNTARIO', vaga: { tipo: 'BOLSISTA' } }),
      inscricao({ nome_completo: 'Bruno', tipo_interesse: 'BOLSISTA', vaga: { tipo: 'VOLUNTARIO' } }),
    ]);
    expect(equipe.bolsistas).toEqual(['Ana']);
    expect(equipe.voluntarios).toEqual(['Bruno']);
  });

  it('vaga "AMBOS" cai no interesse da inscrição; "AMBOS" sem definição vira voluntário', () => {
    const equipe = equipeDasInscricoes([
      inscricao({ nome_completo: 'Ana', tipo_interesse: 'BOLSISTA', vaga: { tipo: 'AMBOS' } }),
      inscricao({ nome_completo: 'Bruno', tipo_interesse: 'AMBOS', vaga: { tipo: 'AMBOS' } }),
      inscricao({ nome_completo: 'Carla', tipo_interesse: 'AMBOS' }),
    ]);
    expect(equipe.bolsistas).toEqual(['Ana']);
    expect(equipe.voluntarios).toEqual(['Bruno', 'Carla']);
  });

  it('não repete nome e ordena alfabeticamente (acentos incluídos)', () => {
    const equipe = equipeDasInscricoes([
      inscricao({ nome_completo: 'Zélia Costa' }),
      inscricao({ nome_completo: '  Ana Souza ' }),
      inscricao({ nome_completo: 'Ana Souza' }),
      inscricao({ nome_completo: 'Álvaro Lima' }),
    ]);
    expect(equipe.voluntarios).toEqual(['Álvaro Lima', 'Ana Souza', 'Zélia Costa']);
    expect(equipe.total).toBe(3);
  });

  it('descarta nome vazio', () => {
    expect(equipeDasInscricoes([inscricao({ nome_completo: '   ' })]).total).toBe(0);
  });

  it('projeto sem inscrição aceita tem total 0 (a página não renderiza o cartão)', () => {
    expect(equipeDasInscricoes([])).toEqual({ bolsistas: [], voluntarios: [], total: 0 });
  });
});

describe('financiamentoDoProjeto', () => {
  it('descarta vazio e repetição', () => {
    expect(financiamentoDoProjeto({ financiamento: ['IFPR', ' IFPR ', '', 'CNPq'] })).toEqual([
      'IFPR',
      'CNPq',
    ]);
  });

  it('sem financiamento informado, lista vazia', () => {
    expect(financiamentoDoProjeto({})).toEqual([]);
    expect(financiamentoDoProjeto({ financiamento: null })).toEqual([]);
  });
});
