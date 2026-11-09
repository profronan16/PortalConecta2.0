import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  search: vi.fn(), embedding: vi.fn(),
  prisma: {
    $queryRaw: vi.fn(),
    documentoKb: { findMany: vi.fn(), findFirst: vi.fn() },
    projeto: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    edital: { count: vi.fn(), findMany: vi.fn() },
    evento: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mock.prisma }));
vi.mock('@/lib/embeddings', () => ({ generateEmbedding: mock.embedding }));
vi.mock('@/lib/busca-vetorial', async original => ({ ...await original<typeof import('@/lib/busca-vetorial')>(), searchSimilarChunks: mock.search }));
import { buscarContextoChat } from '@/lib/chat-context';
import { anoDaFonte, fatorRecencia, rotuloAtualidade, pedidoDeDocumento, consultaDeAgenda, garantirLinksNaResposta, urlAbsoluta } from '@/lib/chat-atualidade';

const anoAtual = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date()));
const chunk = (id: string, doc: string, texto: string, similarity = 0.8) => ({ id, documento_id: doc, documento_titulo: doc, documento_tipo: 'site_ifpr', texto, similarity, metadata: {}, secao: null });
const projeto = { id: 'p1', nome: 'Projeto Aberto', slug: 'aberto', tipo: 'Extensão', resumoCurto: 'Resumo', descricao: 'Desc', coordenador: 'Fulano', status: 'INSCRICOES_ABERTAS', inscricao_fim: null, vagasBolsista: 1, vagasVoluntario: 2 };

beforeEach(() => {
  vi.resetAllMocks();
  mock.embedding.mockRejectedValue(new Error('sem embedding'));
  mock.search.mockResolvedValue([]);
  mock.prisma.documentoKb.findMany.mockResolvedValue([]);
  mock.prisma.projeto.findMany.mockResolvedValue([]); mock.prisma.projeto.count.mockResolvedValue(0);
  mock.prisma.edital.findMany.mockResolvedValue([]); mock.prisma.edital.count.mockResolvedValue(0);
  mock.prisma.evento.findMany.mockResolvedValue([]);
  mock.prisma.$queryRaw.mockResolvedValue([]);
});

describe('atualidade das fontes', () => {
  it('descobre o ano pelos metadados, pelo caminho do WordPress ou pelo título', () => {
    expect(anoDaFonte({ data_publicacao: '2024-03-02' })).toBe(2024);
    expect(anoDaFonte({ url_fonte: 'https://ifpr.edu.br/ivaipora/wp-content/uploads/sites/15/2022/10/x.pdf' })).toBe(2022);
    expect(anoDaFonte({}, 'EDITAL DE PREGÃO nº 01/2019')).toBe(2019);
    expect(anoDaFonte({}, 'Portaria-88.pdf')).toBeNull();
  });
  it('fonte mais recente pesa mais e ano desconhecido não vence ano atual', () => {
    expect(fatorRecencia(anoAtual, anoAtual)).toBeGreaterThan(fatorRecencia(anoAtual - 1, anoAtual));
    expect(fatorRecencia(anoAtual - 1, anoAtual)).toBeGreaterThan(fatorRecencia(anoAtual - 4, anoAtual));
    expect(fatorRecencia(null, anoAtual)).toBeLessThan(1);
  });
  it('marca como ANTIGO documento com dois anos ou mais', () => {
    expect(rotuloAtualidade(anoAtual - 3, anoAtual)).toContain('ANTIGO');
    expect(rotuloAtualidade(anoAtual, anoAtual)).not.toContain('ANTIGO');
    expect(rotuloAtualidade(null, anoAtual)).toContain('não informado');
  });
  it('trecho do documento mais novo vem antes do antigo com relevância igual', async () => {
    mock.search.mockResolvedValue([chunk('a', 'velho', 'prazo do relatório', 0.9), chunk('b', 'novo', 'prazo do relatório', 0.9)]);
    mock.prisma.documentoKb.findMany.mockResolvedValue([
      { id: 'velho', titulo: 'Velho', tipo: 'site_ifpr', refId: null, storagePath: null, metadata: { url_fonte: 'https://ifpr.edu.br/ivaipora/wp-content/uploads/sites/15/2019/01/velho.pdf' } },
      { id: 'novo', titulo: 'Novo', tipo: 'site_ifpr', refId: null, storagePath: null, metadata: { url_fonte: `https://ifpr.edu.br/ivaipora/wp-content/uploads/sites/15/${anoAtual}/01/novo.pdf` } },
    ]);
    const { contexto } = await buscarContextoChat('prazo do relatório final');
    expect(contexto.indexOf('[fonte 1] novo')).toBeGreaterThan(-1); expect(contexto.indexOf('novo')).toBeLessThan(contexto.indexOf('velho'));
    expect(contexto).toContain('ANTIGO');
    expect(contexto).toContain('Link: https://ifpr.edu.br/ivaipora/wp-content/uploads/sites/15/2019/01/velho.pdf');
  });
});

describe('onde encontro o documento', () => {
  it('reconhece pedidos de localização e extrai os termos', () => {
    const r = pedidoDeDocumento('Onde encontro o modelo de relatório final?');
    expect(r.pedido).toBe(true); expect(r.termos).toEqual(expect.arrayContaining(['modelo', 'relatorio', 'final']));
    expect(pedidoDeDocumento('Quais editais estão abertos?').pedido).toBe(false);
  });
  it('coloca o link do documento localizado no contexto, mesmo sem trecho recuperado', async () => {
    mock.prisma.$queryRaw.mockResolvedValue([{ id: 'doc-modelo' }]);
    mock.prisma.documentoKb.findMany.mockResolvedValue([{ id: 'doc-modelo', titulo: 'Modelo-Relatorio-Final.pdf', tipo: 'site_ifpr', refId: null, storagePath: null, metadata: { url_fonte: 'https://ifpr.edu.br/ivaipora/wp-content/uploads/sites/15/2025/03/Modelo-Relatorio-Final.pdf' } }]);
    const r = await buscarContextoChat('Onde encontro o modelo de relatório final?');
    expect(r.contexto).toContain('DOCUMENTO LOCALIZADO: Modelo-Relatorio-Final.pdf');
    expect(r.contexto).toContain('Link: https://ifpr.edu.br/ivaipora/wp-content/uploads/sites/15/2025/03/Modelo-Relatorio-Final.pdf');
    expect(r.solicitados).toHaveLength(1);
  });
  it('acrescenta ao texto o link que o modelo esqueceu', () => {
    const docs = [{ titulo: 'Modelo', url: 'https://x.test/modelo.pdf' }, { titulo: 'Guia', url: '/ifizinha/fontes/9' }];
    const out = garantirLinksNaResposta('O modelo está em https://x.test/modelo.pdf', docs);
    expect(out).toContain('[Guia](https://portal.ifcoding.com.br/ifizinha/fontes/9)'); expect(out.match(/modelo\.pdf/g)).toHaveLength(1);
    expect(garantirLinksNaResposta('ok', [])).toBe('ok');
    expect(urlAbsoluta('/agenda')).toBe('https://portal.ifcoding.com.br/agenda');
  });
});

describe('prioridade de projetos e editais abertos', () => {
  it('com projetos abertos mostra somente os abertos', async () => {
    mock.prisma.projeto.count.mockResolvedValue(1); mock.prisma.projeto.findMany.mockResolvedValue([projeto]);
    const r = await buscarContextoChat('quais projetos existem?');
    const lista = mock.prisma.projeto.findMany.mock.calls.at(-1)![0];
    expect(lista.where.status).toBe('INSCRICOES_ABERTAS');
    expect(r.contexto).toContain('com inscrições abertas');
  });
  it('sem aberto cai para em andamento e depois para encerrados', async () => {
    mock.prisma.projeto.count.mockImplementation(async ({ where }: any) => (where.status?.in?.includes('ENCERRADO') ? 3 : 0));
    mock.prisma.projeto.findMany.mockResolvedValue([{ ...projeto, status: 'ENCERRADO', nome: 'Projeto Antigo', slug: 'antigo' }]);
    const r = await buscarContextoChat('quais projetos existem?');
    expect(mock.prisma.projeto.findMany.mock.calls.at(-1)![0].where.status.in).toContain('ENCERRADO');
    expect(r.contexto).toContain('encerrados ou suspensos');
  });
  it('editais seguem a mesma ordem: abertos, em andamento, encerrados', async () => {
    mock.prisma.edital.count.mockImplementation(async ({ where }: any) => (where.status === 'ENCERRADO' ? 2 : 0));
    mock.prisma.edital.findMany.mockResolvedValue([{ titulo: 'Edital 1/2025', slug: 'e1', categoria: 'BOLSAS', status: 'ENCERRADO', resumoSimples: 'x', resumo: 'x', quemPode: 'x', beneficios: 'x', dataEncerramento: null }]);
    const r = await buscarContextoChat('quais editais existem?');
    expect(mock.prisma.edital.findMany.mock.calls.at(-1)![0].where.status).toBe('ENCERRADO');
    expect(r.contexto).toContain('nenhum edital aberto ou em andamento');
  });
  it('pedido explícito de encerrados não é desviado para abertos', async () => {
    await buscarContextoChat('projetos encerrados');
    expect(mock.prisma.projeto.count.mock.calls.every(([a]: any) => a.where.status === 'ENCERRADO')).toBe(true);
  });
});

describe('agenda de 2026 em diante', () => {
  it('reconhece perguntas de agenda, mês e termos do evento', () => {
    expect(consultaDeAgenda('Quando começa o semestre?', 2026).agenda).toBe(true);
    expect(consultaDeAgenda('O que tem na agenda em março?', 2026).periodo?.inicio.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(consultaDeAgenda('Quais editais estão abertos?', 2026).agenda).toBe(false);
    expect(consultaDeAgenda('quando é a matrícula?', 2026).termos).toContain('matricula');
  });
  it('consulta só eventos a partir de 2026 e informa o link da Agenda', async () => {
    mock.prisma.evento.findMany.mockResolvedValue([{ titulo: 'Início do semestre', descricao: null, data: new Date('2026-02-09T00:00:00Z'), dataFim: null, tipo: 'LETIVO_INICIO_FIM', local: null, linkInscr: null, editalSlug: null, categoria: 'Calendário', publicoAlvo: 'Alunos' }]);
    const r = await buscarContextoChat('quando começa o semestre?');
    const where = JSON.stringify(mock.prisma.evento.findMany.mock.calls[0][0].where);
    expect(where).toMatch(/2026-/);
    expect(r.contexto).toContain('2026-02-09: Início do semestre');
    expect(r.contexto).toContain('Link: https://portal.ifcoding.com.br/agenda');
    expect(r.fontes.some(f => f.tipo === 'agenda')).toBe(true);
  });
  it('sem evento futuro mostra os realizados e diz isso', async () => {
    mock.prisma.evento.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ titulo: 'Recesso', descricao: null, data: new Date('2026-01-02T00:00:00Z'), dataFim: null, tipo: 'RECESSO', local: null, linkInscr: null, editalSlug: null, categoria: null, publicoAlvo: null }]);
    const r = await buscarContextoChat('quais os próximos eventos da agenda?');
    expect(r.contexto).toContain('já realizados');
  });
});
