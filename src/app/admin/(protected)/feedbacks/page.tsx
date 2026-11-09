import { AlertCircle } from 'lucide-react';
import { listarFeedbacks } from '@/actions/feedback';
import { FeedbacksPainel } from '@/components/feedback/FeedbacksPainel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Feedback — Portal Conecta' };

/**
 * Caixa de entrada do feedback enviado em /feedback. O acesso é conferido na
 * Server Action (sessão + papel ADMIN), não só pelo layout.
 */
export default async function FeedbacksAdminPage({
  searchParams,
}: {
  searchParams?: { status?: string; pagina?: string };
}) {
  const resultado = await listarFeedbacks({
    status: searchParams?.status,
    pagina: Number(searchParams?.pagina ?? '1') || 1,
  });

  if (!resultado.ok) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <h1 className="text-lg font-bold text-gray-900">Feedback</h1>
        <p className="max-w-md text-sm text-gray-500">{resultado.error}</p>
      </div>
    );
  }

  return <FeedbacksPainel dados={resultado.data} statusAtual={searchParams?.status} />;
}
