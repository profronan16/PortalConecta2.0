import { describe, it, expect } from 'vitest';
import {
  foiEditadoAposSync,
  decidirAtualizacaoSync,
  mensagemPreservado,
  TOLERANCIA_SYNC_MS,
} from '@/lib/suap-edicao-manual';

/**
 * Testes do item 5.5 / SPEC §14 — "edição manual não é sobrescrita".
 *
 * Antes desta proteção, `syncProjetos`/`syncEditais` sobrescreviam os campos de
 * texto com o que vinha do SUAP, apagando ajustes feitos no portal.
 *
 * A detecção usa `updatedAt` (mantido pelo @updatedAt do Prisma) contra
 * `suapSyncedAt`, gravados no mesmo UPDATE durante a sync.
 */

const syncEm = (iso: string) => ({
  suapSyncedAt: new Date(iso),
  updatedAt: new Date(iso),
});

describe('foiEditadoAposSync', () => {
  it('não considera edição quando updatedAt é igual ao suapSyncedAt (acabou de sincronizar)', () => {
    expect(foiEditadoAposSync(syncEm('2026-09-16T12:00:00Z'))).toBe(false);
  });

  it('tolera a diferença de milissegundos do mesmo UPDATE', () => {
    const registro = {
      suapSyncedAt: new Date('2026-09-16T12:00:00.000Z'),
      updatedAt: new Date('2026-09-16T12:00:00.500Z'),
    };

    expect(foiEditadoAposSync(registro)).toBe(false);
  });

  it('detecta edição manual feita depois do último sync', () => {
    const registro = {
      suapSyncedAt: new Date('2026-09-01T10:00:00Z'),
      updatedAt: new Date('2026-09-10T15:30:00Z'),
    };

    expect(foiEditadoAposSync(registro)).toBe(true);
  });

  it('ignora edições dentro da tolerância configurada', () => {
    const registro = {
      suapSyncedAt: new Date('2026-09-16T12:00:00Z'),
      updatedAt: new Date('2026-09-16T12:00:30Z'),
    };

    expect(foiEditadoAposSync(registro)).toBe(false);
  });

  it('considera edição logo acima da tolerância', () => {
    const registro = {
      suapSyncedAt: new Date('2026-09-16T12:00:00Z'),
      updatedAt: new Date(Date.now()),
    };
    registro.suapSyncedAt = new Date(registro.updatedAt.getTime() - TOLERANCIA_SYNC_MS - 1);

    expect(foiEditadoAposSync(registro)).toBe(true);
  });

  it('não protege registro que nunca foi sincronizado (suapSyncedAt nulo)', () => {
    const registro = {
      suapSyncedAt: null,
      updatedAt: new Date('2026-09-16T12:00:00Z'),
    };

    expect(foiEditadoAposSync(registro)).toBe(false);
  });

  it('trata updatedAt anterior ao sync como ausência de edição (relógio/dado atípico)', () => {
    const registro = {
      suapSyncedAt: new Date('2026-09-16T12:00:00Z'),
      updatedAt: new Date('2026-09-15T12:00:00Z'),
    };

    expect(foiEditadoAposSync(registro)).toBe(false);
  });
});

describe('decidirAtualizacaoSync', () => {
  it('preserva quando houve edição manual', () => {
    expect(decidirAtualizacaoSync({ editadoManualmente: true })).toBe('preservar');
  });

  it('sobrescreve quando não houve edição manual', () => {
    expect(decidirAtualizacaoSync({ editadoManualmente: false })).toBe('sobrescrever');
  });

  it('sobrescreve com sync forçada, mesmo havendo edição manual', () => {
    expect(decidirAtualizacaoSync({ editadoManualmente: true, forcar: true })).toBe('sobrescrever');
  });

  it('sync forçada sem edição manual continua sobrescrevendo', () => {
    expect(decidirAtualizacaoSync({ editadoManualmente: false, forcar: true })).toBe('sobrescrever');
  });
});

describe('mensagemPreservado', () => {
  it('identifica o registro e ensina a forçar a sobrescrita', () => {
    const msg = mensagemPreservado('Horta Comunitária', 42);

    expect(msg).toContain('Horta Comunitária');
    expect(msg).toContain('SUAP ID: 42');
    expect(msg).toContain('sync forçada');
  });
});
