import React from 'react';
import Link from 'next/link';
import {
  Sparkles, BookOpen, FolderOpen, ChevronRight, CheckCircle2,
} from 'lucide-react';

interface HeroIFizinhaProps {
  config?: Record<string, any>;
}

export function HeroIFizinha({ config = {} }: HeroIFizinhaProps) {
  const quickStats = [
    { value: config.stat_projetos || '25+', label: 'Projetos ativos' },
    { value: config.stat_editais || '4',   label: 'Editais abertos' },
    { value: config.stat_estudantes || '300+', label: 'Estudantes' },
  ];

  return (
    <section className="relative min-h-screen bg-hero-gradient flex items-center overflow-hidden">

      {/* ── Background layer ──────────────────────────────────────── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        {/* Radial glow spots — brand colors */}
        <div className="absolute top-1/3 left-1/4  w-[480px] h-[480px] bg-glow-azul  opacity-50" />
        <div className="absolute bottom-1/4 right-1/3 w-[400px] h-[400px] bg-glow-roxo opacity-35" />
        <div className="absolute top-1/2  right-1/4  w-[320px] h-[320px] bg-glow-rosa opacity-25" />
        {/* Soft blob corners */}
        <div className="absolute -top-40  -right-40 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px),' +
              'linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
      </div>

      {/* ── Main content ──────────────────────────────────────────── */}
      <div className="relative container mx-auto px-4 max-w-7xl pt-28 pb-28 lg:pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">

          {/* ── LEFT: IFizinha introduction ───────────────────────── */}
          <div className="text-white">

            {/* Identity pill */}
            <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm rounded-full px-4 py-2.5 text-sm font-semibold mb-8 border border-white/25">
              <Sparkles className="w-4 h-4 text-dourado-500 animate-sparkle flex-shrink-0" />
              <span>Oi! Eu sou a IFizinha 👋</span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl md:text-5xl lg:text-[3.5rem] font-black leading-[1.06] mb-6 tracking-tight">
              {config.hero_titulo || 'Tudo do IFPR'}
              <br />
              <span className="text-dourado-500 drop-shadow">
                {config.hero_subtitulo || 'traduzido pra você'}
              </span>
              <span className="ml-3 inline-block animate-sparkle select-none">✨</span>
            </h1>

            {/* Body copy */}
            <p className="text-white/85 text-lg md:text-xl leading-relaxed mb-8 max-w-[30rem]">
              Editais complicados? Deixa comigo! Sou a{' '}
              <strong className="text-white font-bold">IFizinha</strong>,
              embaixadora virtual do{' '}
              <strong className="text-white font-bold">Marketing Digital Solidário</strong>{' '}
              do IFPR Campus Ivaiporã. Aqui você encontra tudo em um lugar só —
              sem precisar de dicionário.
            </p>

            {/* CTA row */}
            <div className="flex flex-col sm:flex-row gap-3 mb-10">
              <Link
                href="/editais"
                className="inline-flex items-center justify-center gap-2 bg-white text-azul-500 font-bold px-8 py-4 rounded-xl hover:bg-white/92 active:scale-[0.98] transition-all shadow-lg hover:shadow-xl text-base"
              >
                <BookOpen className="w-5 h-5 flex-shrink-0" />
                {config.hero_cta_editais || 'Ver Editais Abertos'}
              </Link>
              <Link
                href="/projetos"
                className="inline-flex items-center justify-center gap-2 bg-white/15 backdrop-blur-sm text-white font-semibold px-8 py-4 rounded-xl hover:bg-white/25 active:scale-[0.98] transition-all border border-white/30 text-base"
              >
                <FolderOpen className="w-5 h-5 flex-shrink-0" />
                {config.hero_cta_projetos || 'Explorar Projetos'}
              </Link>
            </div>

            {/* Quick stats */}
            <div className="flex flex-wrap gap-8 pt-8 border-t border-white/20">
              {quickStats.map((s) => (
                <div key={s.label}>
                  <p className="text-[2rem] font-black text-white leading-none">{s.value}</p>
                  <p className="text-white/65 text-sm mt-1">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT: IFizinha chat card ──────────────────────────── */}
          <div className="flex justify-center items-center mt-4 lg:mt-0">
            <div className="relative w-full max-w-sm lg:max-w-[22rem] animate-float">

              {/* Dourado glow behind the card */}
              <div
                className="absolute inset-0 bg-glow-dourado opacity-50 scale-[1.35] pointer-events-none"
                aria-hidden
              />

              {/* Card */}
              <div className="relative bg-white/15 backdrop-blur-md rounded-3xl p-6 border border-white/30 shadow-2xl">

                {/* Card header — IFizinha avatar + status */}
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-14 h-14 rounded-2xl bg-dourado-500 shadow-glow-dourado flex items-center justify-center text-2xl flex-shrink-0 select-none">
                    ✨
                  </div>
                  <div>
                    <p className="text-white font-bold text-lg leading-none">IFizinha</p>
                    <p className="text-white/65 text-sm mt-0.5">Embaixadora do Campus</p>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
                    <span className="text-white/60 text-xs font-medium">online</span>
                  </div>
                </div>

                {/* Chat bubbles */}
                <div className="space-y-3">
                  {/* IFizinha speaks */}
                  <div className="bg-white/20 rounded-2xl rounded-tl-sm p-4 border border-white/10">
                    <p className="text-white text-sm leading-relaxed">
                      Ei, estudante! Tem{' '}
                      {/* Antes era "4 editais abertos" fixo no código, enquanto os cards
                          logo abaixo (e o admin) mostravam o número real — o SPEC §5.1
                          proíbe essa divergência. Agora usa o mesmo valor configurável. */}
                      <strong className="text-dourado-400">{config.stat_editais || '4'} editais abertos</strong>{' '}
                      essa semana — e um deles encerra em breve. Quer que eu explique? 👀
                    </p>
                  </div>
                  {/* User reply */}
                  <div className="bg-white rounded-2xl rounded-tr-sm p-4 ml-10 shadow-sm">
                    <p className="text-gray-700 text-sm">Sim! Me explica! 🙏</p>
                  </div>
                  {/* IFizinha explains */}
                  <div className="bg-white/20 rounded-2xl rounded-tl-sm p-4 border border-white/10">
                    <p className="text-white text-sm leading-relaxed">
                      Claro! O{' '}
                      <strong className="text-dourado-400">Auxílio Estudantil</strong>{' '}
                      tem bolsa de até R$&nbsp;350/mês e encerra dia&nbsp;15/08.
                      Vou te mostrar tudo de forma simples! 🎯
                    </p>
                  </div>
                </div>

                {/* Card CTA */}
                <Link
                  href="/editais"
                  className="mt-5 flex items-center justify-center gap-2 bg-dourado-500 hover:bg-dourado-400 active:scale-[0.98] text-gray-900 font-bold py-3 rounded-xl transition-all text-sm shadow-glow-dourado"
                >
                  Ver editais com a IFizinha
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>

              {/* Floating badge — top right — hidden on small mobile */}
              <div className="hidden sm:block absolute -top-4 -right-4 bg-green-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg animate-bounce select-none">
                4 abertos!
              </div>

              {/* Floating badge — bottom left — hidden on small mobile */}
              <div className="hidden sm:flex absolute -bottom-5 -left-4 bg-white text-azul-500 text-xs font-bold px-3 py-1.5 rounded-full shadow-lg items-center gap-1.5 select-none">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                Linguagem simples
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Wave separator ────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0" aria-hidden>
        <svg
          viewBox="0 0 1440 72"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full block"
          preserveAspectRatio="none"
        >
          <path
            d="M0 72L60 61C120 50 240 28 360 20C480 12 600 22 720 30C840 38 960 42 1080 38C1200 34 1320 24 1380 19L1440 14V72H0Z"
            fill="white"
          />
        </svg>
      </div>
    </section>
  );
}
