import { prisma } from '@/lib/prisma';
import { editalInteressaAoAlerta, resumoCategoriasAlerta } from '@/lib/minha-area';
import { criarNotificacao } from '@/lib/notificacoes';
import { enviarAlertaEdital } from '@/lib/email';

/**
 * PRODUTOR dos alertas de interesse (ROADMAP 6.4).
 *
 * Quando um edital passa a PUBLICADO, avisa quem assinou alerta:
 *  - canal `portal` → cria notificação interna (aparece no sino);
 *  - canal `email`  → envia e-mail (src/lib/email.ts).
 *
 * Idempotência: se o mesmo edital for publicado duas vezes (despublicar e
 * publicar de novo), quem já recebeu não recebe de novo — a checagem é feita
 * por `link` + `user_id` antes de criar/enviar.
 */

export type ResultadoAlerta = {
  portal: number;
  email: number;
  jaAvisados: number;
  semInteresse: number;
};

const ZERADO: ResultadoAlerta = { portal: 0, email: 0, jaAvisados: 0, semInteresse: 0 };

export async function dispararAlertasDeEdital(editalId: string): Promise<ResultadoAlerta> {
  try {
    const edital = await prisma.edital.findUnique({
      where: { id: editalId },
      select: {
        id: true,
        titulo: true,
        slug: true,
        categoria: true,
        review_status: true,
        deleted_at: true,
        dataEncerramento: true,
      },
    });

    // Só edital efetivamente público gera aviso.
    if (!edital || edital.review_status !== 'PUBLICADO' || edital.deleted_at) {
      return ZERADO;
    }

    const alertas = await prisma.alertaInteresse.findMany({
      where: { ativo: true },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    const link = `/editais/${edital.slug}`;
    const interessados = alertas.filter((a) =>
      editalInteressaAoAlerta(edital.categoria, a.categorias),
    );

    const resultado: ResultadoAlerta = {
      ...ZERADO,
      semInteresse: alertas.length - interessados.length,
    };

    if (interessados.length === 0) return resultado;

    // Quem já tem notificação com este link não é avisado de novo.
    const jaNotificados = await prisma.notificacao.findMany({
      where: {
        link,
        user_id: { in: interessados.map((a) => a.user_id) },
      },
      select: { user_id: true },
    });
    const idsJaNotificados = new Set(jaNotificados.map((n) => n.user_id));

    for (const alerta of interessados) {
      if (idsJaNotificados.has(alerta.user_id)) {
        resultado.jaAvisados++;
        continue;
      }

      if (alerta.canal === 'portal') {
        const criada = await criarNotificacao({
          userId: alerta.user_id,
          titulo: `Novo edital: ${edital.titulo}`,
          texto: `Categoria ${edital.categoria} — você pediu para acompanhar ${resumoCategoriasAlerta(alerta.categorias).toLowerCase()}.`,
          link,
        });
        if (criada) resultado.portal++;
        continue;
      }

      if (alerta.canal === 'email' && alerta.user?.email) {
        const envio = await enviarAlertaEdital({
          email: alerta.user.email,
          nome: alerta.user.name,
          editalTitulo: edital.titulo,
          editalCategoria: edital.categoria,
          editalSlug: edital.slug,
          dataEncerramento: edital.dataEncerramento,
        });
        if (envio.ok) resultado.email++;
      }
    }

    return resultado;
  } catch (error) {
    console.warn('[alertas] falha ao disparar alertas do edital:', error);
    return ZERADO;
  }
}
