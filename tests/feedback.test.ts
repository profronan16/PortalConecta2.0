import { describe, expect, it } from 'vitest';
import {
  MENSAGEM_MAX,
  caminhoDaPagina,
  previaDaMensagem,
  rotuloDoTipo,
  statusValido,
  validarFeedback,
} from '@/lib/feedback';

const base = { tipo: 'sugestao', mensagem: 'A busca de editais poderia filtrar por curso.' };

describe('validarFeedback', () => {
  it('aceita uma mensagem válida e normaliza os campos', () => {
    const r = validarFeedback({ ...base, contato: '  Maria@Exemplo.COM ', pagina: '/editais?q=bolsa#topo' });
    expect(r).toEqual({
      ok: true,
      dados: { tipo: 'sugestao', mensagem: base.mensagem, contato: 'maria@exemplo.com', pagina: '/editais' },
    });
  });

  it('o e-mail e a página são opcionais', () => {
    const r = validarFeedback(base);
    expect(r).toMatchObject({ ok: true, dados: { contato: null, pagina: null } });
  });

  it('recusa tipo desconhecido ou ausente', () => {
    expect(validarFeedback({ ...base, tipo: 'spam' })).toMatchObject({ ok: false });
    expect(validarFeedback({ mensagem: base.mensagem })).toMatchObject({ ok: false });
  });

  it('recusa mensagem curta demais ou só com espaços', () => {
    expect(validarFeedback({ ...base, mensagem: 'oi' })).toMatchObject({ ok: false });
    expect(validarFeedback({ ...base, mensagem: '          \n\n       ' })).toMatchObject({ ok: false });
    expect(validarFeedback({ ...base, mensagem: 123 })).toMatchObject({ ok: false });
  });

  it('recusa mensagem acima do limite', () => {
    expect(validarFeedback({ ...base, mensagem: 'a'.repeat(MENSAGEM_MAX + 1) })).toMatchObject({ ok: false });
    expect(validarFeedback({ ...base, mensagem: 'a'.repeat(MENSAGEM_MAX) })).toMatchObject({ ok: true });
  });

  it('limpa caracteres de controle e quebras de linha em excesso, mantendo parágrafos', () => {
    const r = validarFeedback({ ...base, mensagem: 'Primeira linha\u0000 do texto\r\n\r\n\r\n\r\nSegundo parágrafo' });
    expect(r).toMatchObject({ ok: true, dados: { mensagem: 'Primeira linha do texto\n\nSegundo parágrafo' } });
  });

  it('recusa e-mail inválido, mas aceita em branco', () => {
    expect(validarFeedback({ ...base, contato: 'sem-arroba' })).toMatchObject({ ok: false });
    expect(validarFeedback({ ...base, contato: 'a@b' })).toMatchObject({ ok: false });
    expect(validarFeedback({ ...base, contato: '   ' })).toMatchObject({ ok: true, dados: { contato: null } });
  });

  it('descarta em silêncio quando o campo-isca vem preenchido', () => {
    expect(validarFeedback({ ...base, website: 'http://spam.example' })).toEqual({ ok: 'descartado' });
    expect(validarFeedback({ ...base, website: '   ' })).toMatchObject({ ok: true });
  });

  it('não guarda HTML interpretado: o texto segue como veio, para ser exibido escapado', () => {
    const r = validarFeedback({ ...base, mensagem: '<script>alert(1)</script> teste de mensagem' });
    expect(r).toMatchObject({ ok: true, dados: { mensagem: '<script>alert(1)</script> teste de mensagem' } });
  });
});

describe('caminhoDaPagina', () => {
  it('guarda só o caminho, sem query nem âncora', () => {
    expect(caminhoDaPagina('/projetos/horta?token=abc#x')).toBe('/projetos/horta');
  });
  it('recusa endereço externo, protocolo relativo e tipos errados', () => {
    expect(caminhoDaPagina('https://outro.site/x')).toBeNull();
    expect(caminhoDaPagina('//outro.site/x')).toBeNull();
    expect(caminhoDaPagina(undefined)).toBeNull();
    expect(caminhoDaPagina(42)).toBeNull();
  });
  it('limita o tamanho', () => {
    expect(caminhoDaPagina(`/${'a'.repeat(500)}`)!.length).toBe(200);
  });
});

describe('apoio', () => {
  it('rotula tipos e valida status', () => {
    expect(rotuloDoTipo('problema')).toBe('Problema no site');
    expect(rotuloDoTipo('qualquer')).toBe('Outro assunto');
    expect(statusValido('lido')).toBe(true);
    expect(statusValido('apagado')).toBe(false);
  });
  it('prévia achata espaços e corta com reticências', () => {
    expect(previaDaMensagem('a\n\n  b   c')).toBe('a b c');
    expect(previaDaMensagem('x'.repeat(200), 20)).toHaveLength(20);
    expect(previaDaMensagem('x'.repeat(200), 20).endsWith('…')).toBe(true);
  });
});
