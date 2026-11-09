import { describe, it, expect, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({ inscricao: { findFirst: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, db: prismaMock }));

import { criarComProtocolo, montarProtocolo, protocoloSeguinte } from '@/lib/protocolo-inscricao';

describe('protocoloSeguinte', () => {
  it('parte do maior protocolo, não da quantidade (inscrições apagadas deixam buracos)', () => {
    expect(protocoloSeguinte(2026, 'PRJ-2026-000047')).toBe('PRJ-2026-000048');
  });
  it('primeiro do ano', () => {
    expect(protocoloSeguinte(2026, null)).toBe('PRJ-2026-000001');
    expect(protocoloSeguinte(2026, undefined)).toBe('PRJ-2026-000001');
  });
  it('valor fora do padrão não quebra', () => {
    expect(protocoloSeguinte(2026, 'lixo')).toBe('PRJ-2026-000001');
  });
  it('largura fixa de 6 dígitos', () => {
    expect(montarProtocolo(2026, 9)).toBe('PRJ-2026-000009');
  });
});

describe('criarComProtocolo', () => {
  it('repete com o número seguinte quando outro processo pegou o mesmo protocolo', async () => {
    prismaMock.inscricao.findFirst
      .mockResolvedValueOnce({ protocolo: 'PRJ-2026-000010' })
      .mockResolvedValueOnce({ protocolo: 'PRJ-2026-000011' });
    const criar = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unique constraint failed on the fields: (`protocolo`)'))
      .mockResolvedValueOnce('ok');
    const ano = new Date().getFullYear();
    await expect(criarComProtocolo(criar)).resolves.toBe('ok');
    expect(criar.mock.calls.map((c) => c[0])).toEqual([
      `PRJ-${ano}-000011`,
      `PRJ-${ano}-000012`,
    ]);
  });

  it('erro que não é de protocolo sobe na hora, sem repetir', async () => {
    prismaMock.inscricao.findFirst.mockResolvedValue(null);
    const criar = vi.fn().mockRejectedValue(new Error('Inscricao_user_id_fkey'));
    await expect(criarComProtocolo(criar)).rejects.toThrow('Inscricao_user_id_fkey');
    expect(criar).toHaveBeenCalledTimes(1);
  });
});
