import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Sparkles, Heart, ExternalLink, Instagram, Mail, MapPin, type LucideIcon } from 'lucide-react';
import { MascoteIFizinha } from '@/components/ifizinha/MascoteIFizinha';

/**
 * Endereço oficial do Campus Ivaiporã — copiado do rodapé de
 * https://ifpr.edu.br/ivaipora/ (conferido em 05/10/2026). Mantenha igual ao do
 * site oficial: é o que o aluno usa para chegar no campus (e para ônibus/apps).
 */
const ENDERECO_OFICIAL =
  'Rua Max Arthur Greipel, 505 - Parque Industrial I, Ivaiporã - PR, 86873-400';

const MAPA_QUERY = encodeURIComponent(ENDERECO_OFICIAL);
// `output=embed` é a forma de embed do Google Maps que NÃO exige chave de API.
// O iframe fica com loading="lazy": só carrega quando o rodapé chega na tela,
// então as páginas públicas não pagam esse peso na primeira dobra.
const MAPA_EMBED = `https://www.google.com/maps?q=${MAPA_QUERY}&z=16&hl=pt-BR&output=embed`;
// Fallback (e link de "abrir no app"): funciona mesmo se o iframe for bloqueado
// por bloqueador de anúncio/rede.
const MAPA_LINK = `https://www.google.com/maps/search/?api=1&query=${MAPA_QUERY}`;

type Contato = {
  href: string;
  rotulo: string;
  /** Texto curto ao lado do rótulo (ex.: marcar que aquele @ é da IFizinha). */
  sufixo?: string;
  icone: LucideIcon;
};

const CONTATOS: Contato[] = [
  {
    href: 'https://ifpr.edu.br/ivaipora/',
    rotulo: 'Site oficial do IFPR',
    icone: ExternalLink,
  },
  {
    href: 'mailto:comunicacao.ivaipora@ifpr.edu.br',
    rotulo: 'comunicacao.ivaipora@ifpr.edu.br',
    icone: Mail,
  },
  {
    href: 'https://www.instagram.com/ifpr.campus.ivaipora/',
    rotulo: '@ifpr.campus.ivaipora',
    icone: Instagram,
  },
  {
    href: 'https://www.instagram.com/ifizinha.ifpr/',
    rotulo: '@ifizinha.ifpr',
    sufixo: 'IFizinha',
    icone: Instagram,
  },
];

export function Footer() {
  return (
    <footer className="relative overflow-hidden bg-azul-950 text-gray-300">
      {/* Mascote decorativa (telas largas): ancorada no canto — o fundo da imagem
          encosta no fim do rodapé, então ela parece "sair" de dentro dele, em vez
          de flutuar solta no meio do espaço vazio. A barra final ganha respiro à
          direita para o texto não passar por baixo dela.
          Pose: a do tablet ("hero"), que é **neutra** (segura o tablet com as
          duas mãos). As poses de "apresentar" gesticulam para a direita da
          imagem — neste canto elas apontariam para fora da tela. */}
      <div className="pointer-events-none absolute bottom-0 right-0 hidden w-48 select-none xl:block 2xl:w-56" aria-hidden>
        <div className="-mr-4">
          <MascoteIFizinha nome="hero" />
        </div>
      </div>
      {/* IFizinha CTA */}
      <div className="relative bg-hero-gradient py-12">
        {/* Véu escuro leve: o gradiente termina em rosa (#E83D89), onde o branco
            puro dá só ~3,9:1. Com o véu, o texto branco passa de 4,5:1 (WCAG AA
            para texto normal) sem mudar a identidade da faixa. */}
        <div className="absolute inset-0 bg-black/15" aria-hidden />
        <div className="container relative mx-auto px-4 max-w-7xl text-center">
          <div className="inline-flex items-center gap-2 bg-white/15 rounded-full px-4 py-1.5 text-white text-sm mb-4">
            <Sparkles className="w-4 h-4" />
            Dica da IFizinha
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
            Nunca perca um edital importante!
          </h2>
          <p className="text-white/95 max-w-xl mx-auto mb-6">
            A IFizinha traduz todos os editais do IFPR para você entender de verdade.
            Confira sempre o edital oficial para ter certeza dos detalhes.
          </p>
          <Link
            href="/editais"
            className="inline-flex items-center gap-2 bg-white text-azul-eletrico font-semibold px-6 py-3 rounded-xl hover:bg-white/90 transition-colors shadow-lg"
          >
            <Sparkles className="w-5 h-5" />
            Ver Editais Abertos
          </Link>
        </div>
      </div>

      {/* Main Footer */}
      <div className="container mx-auto px-4 max-w-7xl py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Logo, descrição, endereço e mapa */}
          <div className="md:col-span-2">
            {/* O lockup do logo tem o nome em azul-marinho, que desapareceria
                sobre o rodapé azul — por isso ele vai numa placa clara (mesma
                solução que o mockup resolve com uma versão branca da marca). */}
            <div className="mb-5 inline-flex items-center rounded-2xl bg-white px-3.5 py-2.5 shadow-lg">
              <Image
                src="/ifizinha/logo-completo.webp"
                alt="Portal Conecta — IFPR Campus Ivaiporã"
                width={1400}
                height={467}
                unoptimized
                className="h-10 w-auto"
              />
            </div>
            <p className="text-gray-400 text-sm leading-relaxed mb-5 max-w-sm">
              Centralizando a comunicação institucional do IFPR Campus Ivaiporã.
              Editais, projetos e agenda em um só lugar, traduzidos pela IFizinha.
            </p>

            <address className="not-italic flex items-start gap-3 text-sm text-gray-400 leading-relaxed max-w-sm">
              <MapPin className="w-4 h-4 text-azul-eletrico flex-shrink-0 mt-0.5" />
              <span>
                Rua Max Arthur Greipel, nº 505 — Parque Industrial I — Porfírio Basso
                <br />
                Caixa Postal 138 · Ivaiporã/PR · CEP 86.873-400
              </span>
            </address>

            <div className="mt-5 w-full max-w-md rounded-2xl overflow-hidden border border-gray-800 shadow-lg bg-gray-900">
              <iframe
                title="Mapa — IFPR Campus Ivaiporã (Rua Max Arthur Greipel, 505)"
                src={MAPA_EMBED}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="block w-full h-52 border-0"
              />
            </div>
            <a
              href={MAPA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-azul-eletrico hover:text-white transition-colors mt-2"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Ver no Google Maps / abrir no app
            </a>
          </div>

          {/* Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">Navegação</h3>
            <ul className="space-y-2 text-sm">
              {[
                { href: '/', label: 'Início' },
                { href: '/editais', label: 'Editais' },
                { href: '/projetos', label: 'Projetos' },
                { href: '/agenda', label: 'Agenda' },
                // Transparência da IA: lista tudo o que a IFizinha "sabe", com
                // link para a fonte de cada documento.
                { href: '/ifizinha/conteudos', label: 'O que a IFizinha conhece' },
                { href: '/feedback', label: 'Enviar feedback' },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contato */}
          <div>
            <h3 className="text-white font-semibold mb-4">Contato</h3>
            <ul className="space-y-2 text-sm">
              {CONTATOS.map(({ href, rotulo, sufixo, icone: Icone }) => (
                <li key={href}>
                  <a
                    href={href}
                    {...(href.startsWith('mailto:')
                      ? {}
                      : { target: '_blank', rel: 'noopener noreferrer' })}
                    className="flex items-start gap-2 text-gray-400 hover:text-white transition-colors break-all"
                  >
                    <Icone className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      {rotulo}
                      {sufixo ? <span className="text-gray-500 text-xs"> ({sufixo})</span> : null}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-white/10 mt-10 pt-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-gray-400 xl:pr-52">
          <p>
            © {new Date().getFullYear()} Portal Conecta IFPR Ivaiporã. Todos os direitos reservados.
          </p>
          <p className="flex items-center gap-1">
            Desenvolvido com <Heart className="w-3 h-3 text-rosa-vibrante fill-rosa-vibrante" /> pelo{' '}
            <span className="text-azul-eletrico font-medium">Marketing Digital Solidário</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
