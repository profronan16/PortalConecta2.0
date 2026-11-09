import React from 'react';
import { MessageSquareHeart } from 'lucide-react';
import type { Metadata } from 'next';
import { PageHero } from '@/components/layout/PageHero';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import { caminhoDaPagina } from '@/lib/feedback';

export const metadata: Metadata = {
  title: 'Enviar feedback',
  description: 'Conte o que você achou do Portal Conecta: sugestões, problemas, dúvidas ou elogios chegam direto para a equipe.',
};

interface Props {
  searchParams?: { origem?: string };
}

export default function FeedbackPage({ searchParams }: Props) {
  const origem = caminhoDaPagina(searchParams?.origem) ?? undefined;

  return (
    <div className="min-h-screen">
      <PageHero
        trilha={[{ href: '/', label: 'Início' }, { label: 'Feedback' }]}
        etiqueta="Fale com a gente"
        titulo="Enviar feedback"
        descricao="Encontrou um problema, tem uma ideia ou quer elogiar? A sua mensagem chega direto para a equipe do Portal Conecta e ajuda a melhorar o site para todo mundo."
        icone={<MessageSquareHeart className="h-7 w-7 text-azul-eletrico" />}
        fundoIcone="bg-azul-50"
      />
      <div className="relative z-10 bg-gray-50">
        <div className="container mx-auto max-w-2xl px-4 py-10">
          <FeedbackForm paginaOrigem={origem} />
        </div>
      </div>
    </div>
  );
}
