import { describe, it, expect } from 'vitest';
import { gerarICS } from '@/lib/evento-helpers';

/**
 * Critérios §14 do bloco "Agenda":
 *  - "Eventos de calendário, editais e projetos aparecem unificados e filtráveis";
 *  - "Exportação .ics funciona".
 *
 * A exportação é o que dá para blindar de forma determinística: o arquivo .ics
 * precisa ser válido (BEGIN/END casando), usar CRLF (exigido pelo RFC 5545) e
 * escapar os caracteres especiais — um título com vírgula ou ponto e vírgula,
 * sem escape, corrompe o arquivo em qualquer cliente de calendário.
 */

const evento = {
  titulo: 'Reunião do projeto',
  descricao: 'Pauta: cronograma',
  data: new Date('2026-09-20T13:00:00Z'),
  dataFim: null,
  local: 'IFPR Ivaiporã',
};

describe('gerarICS — estrutura do arquivo', () => {
  it('gera um VCALENDAR válido com um VEVENT por evento', () => {
    const ics = gerarICS([evento]);

    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR')).toBe(true);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect((ics.match(/END:VEVENT/g) ?? []).length).toBe(1);
  });

  it('usa CRLF como separador de linha (exigência do RFC 5545)', () => {
    const ics = gerarICS([evento]);

    expect(ics).toContain('\r\n');
    // Nenhum \n solto: todo LF precisa vir precedido de CR.
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it('declara versão, prodid e fuso do calendário', () => {
    const ics = gerarICS([evento]);

    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//Portal Conecta IFPR//Events//PT');
    expect(ics).toContain('X-WR-TIMEZONE:America/Sao_Paulo');
  });

  it('gera calendário sem eventos quando a lista está vazia', () => {
    const ics = gerarICS([]);

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('gera um VEVENT para cada evento da lista', () => {
    const ics = gerarICS([evento, { ...evento, titulo: 'Outro evento' }]);

    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect(ics).toContain('SUMMARY:Outro evento');
  });
});

describe('gerarICS — datas', () => {
  it('formata DTSTART em UTC no padrão do iCalendar', () => {
    const ics = gerarICS([evento]);

    expect(ics).toContain('DTSTART:20260920T130000Z');
  });

  it('usa +1h como duração padrão quando não há data de fim', () => {
    const ics = gerarICS([evento]);

    expect(ics).toContain('DTEND:20260920T140000Z');
  });

  it('respeita a data de fim quando informada', () => {
    const ics = gerarICS([{ ...evento, dataFim: new Date('2026-09-20T18:30:00Z') }]);

    expect(ics).toContain('DTEND:20260920T183000Z');
  });

  it('inclui DTSTAMP (obrigatório) em todos os eventos', () => {
    const ics = gerarICS([evento, { ...evento, titulo: 'B' }]);

    expect((ics.match(/DTSTAMP:/g) ?? []).length).toBe(2);
  });

  it('gera UID único por evento (título + timestamp)', () => {
    const ics = gerarICS([evento]);
    const uid = ics.split('\r\n').find((l) => l.startsWith('UID:'));

    expect(uid).toContain('@portal-conecta-ifpr');
    expect(uid).toContain(String(evento.data.getTime()));
  });
});

describe('gerarICS — escape de caracteres especiais', () => {
  it('escapa vírgula, ponto e vírgula, barra invertida e quebra de linha', () => {
    const ics = gerarICS([
      {
        ...evento,
        titulo: 'Prazo; inscrição, com \\ e\nquebra',
        descricao: null,
        local: null,
      },
    ]);
    const summary = ics.split('\r\n').find((l) => l.startsWith('SUMMARY:'));

    expect(summary).toBe('SUMMARY:Prazo\\; inscrição\\, com \\\\ e\\nquebra');
  });

  it('omite DESCRIPTION e LOCATION quando não informados', () => {
    const ics = gerarICS([{ ...evento, descricao: null, local: null }]);

    expect(ics).not.toContain('DESCRIPTION:');
    expect(ics).not.toContain('LOCATION:');
  });

  it('inclui descrição e local quando informados', () => {
    const ics = gerarICS([evento]);

    expect(ics).toContain('DESCRIPTION:Pauta: cronograma');
    expect(ics).toContain('LOCATION:IFPR Ivaiporã');
  });
});
