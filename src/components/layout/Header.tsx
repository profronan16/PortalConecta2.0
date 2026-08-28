'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X, Sparkles, BookOpen, FolderOpen, Calendar, ChevronRight, LayoutDashboard, LogIn, LogOut, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

const navItems = [
  { href: '/editais', label: 'Editais', icon: BookOpen, description: 'Oportunidades traduzidas pela IFizinha' },
  { href: '/projetos', label: 'Projetos', icon: FolderOpen, description: '25+ projetos de extensão ativos' },
  { href: '/agenda', label: 'Agenda', icon: Calendar, description: 'Prazos e eventos do campus' },
];

export function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user, userRole, loading, signOut } = useAuth();

  // Só Admin e Professor têm um painel pra administrar (editais/projetos
  // pro Admin, os próprios projetos pro Professor) — Estudante não tem
  // painel nenhum, então o link nem deve aparecer pra ele.
  const painelHref = userRole === 'ADMIN' ? '/admin' : userRole === 'PROFESSOR' ? '/professor' : null;
  const painelLabel = userRole === 'ADMIN' ? 'Admin' : 'Painel';

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  const isHome = pathname === '/';

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        isScrolled || !isHome
          ? 'bg-white/95 backdrop-blur-md shadow-md border-b border-gray-100'
          : 'bg-transparent'
      )}
    >
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex items-center justify-between h-16 md:h-20">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-hero-gradient flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <span
                className={cn(
                  'font-bold text-lg leading-none block transition-colors',
                  isScrolled || !isHome ? 'text-gray-900' : 'text-white'
                )}
              >
                Portal Conecta
              </span>
              <span
                className={cn(
                  'text-xs font-medium transition-colors',
                  isScrolled || !isHome ? 'text-azul-eletrico' : 'text-white/80'
                )}
              >
                IFPR Ivaiporã
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-azul-eletrico/10 text-azul-eletrico'
                      : isScrolled || !isHome
                      ? 'text-gray-600 hover:text-azul-eletrico hover:bg-gray-100'
                      : 'text-white/90 hover:text-white hover:bg-white/10'
                  )}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* CTA + Admin + Mobile Toggle */}
          <div className="flex items-center gap-2">
            <Link
              href="/editais"
              className={cn(
                'hidden md:flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                'bg-hero-gradient text-white shadow hover:opacity-90 hover:shadow-md'
              )}
            >
              <Sparkles className="w-4 h-4" />
              Ver Editais
            </Link>

            {/* Admin / Login button */}
            {!loading && (
              user ? (
                <div className="flex items-center gap-1">
                  <Link
                    href="/meus-dados"
                    title="Meus Dados"
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all',
                      isScrolled || !isHome
                        ? 'text-gray-600 hover:text-azul-eletrico hover:bg-gray-100'
                        : 'text-white/80 hover:text-white hover:bg-white/10'
                    )}
                  >
                    <span className="hidden md:inline">Meus Dados</span>
                  </Link>
                  {painelHref && (
                    <Link
                      href={painelHref}
                      title={painelLabel === 'Admin' ? 'Painel Admin' : 'Painel do Professor'}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all',
                        isScrolled || !isHome
                          ? 'text-gray-600 hover:text-azul-eletrico hover:bg-gray-100'
                          : 'text-white/80 hover:text-white hover:bg-white/10'
                      )}
                    >
                      <LayoutDashboard className="w-4 h-4" />
                      <span className="hidden md:inline">{painelLabel}</span>
                    </Link>
                  )}
                  <button
                    onClick={handleLogout}
                    title="Sair"
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all',
                      isScrolled || !isHome
                        ? 'text-gray-600 hover:text-red-600 hover:bg-red-50'
                        : 'text-white/80 hover:text-white hover:bg-white/10'
                    )}
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="hidden md:inline">Sair</span>
                  </button>
                </div>
              ) : (
                <Link
                  href="/admin/login"
                  title="Entrar"
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                    isScrolled || !isHome
                      ? 'text-gray-500 hover:text-azul-eletrico hover:bg-gray-100'
                      : 'text-white/60 hover:text-white hover:bg-white/10'
                  )}
                >
                  <LogIn className="w-4 h-4" />
                </Link>
              )
            )}

            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className={cn(
                'md:hidden p-2 rounded-lg transition-colors',
                isScrolled || !isHome
                  ? 'text-gray-700 hover:bg-gray-100'
                  : 'text-white hover:bg-white/10'
              )}
              aria-label="Abrir menu"
            >
              {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="md:hidden bg-white border-t border-gray-100 shadow-xl">
          <div className="container mx-auto px-4 py-4 space-y-1">
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center justify-between p-4 rounded-xl transition-all',
                    isActive
                      ? 'bg-azul-eletrico/10 text-azul-eletrico'
                      : 'text-gray-700 hover:bg-gray-50'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'w-9 h-9 rounded-lg flex items-center justify-center',
                        isActive ? 'bg-azul-eletrico text-white' : 'bg-gray-100 text-gray-500'
                      )}
                    >
                      <item.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{item.label}</p>
                      <p className="text-xs text-gray-500">{item.description}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </Link>
              );
            })}

            {/* Conta */}
            {!loading && (
              <div className="pt-2 mt-2 border-t border-gray-100 space-y-1">
                {user ? (
                  <>
                    <Link
                      href="/meus-dados"
                      className="flex items-center gap-3 p-4 rounded-xl text-gray-700 hover:bg-gray-50 transition-all"
                    >
                      <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center">
                        <User className="w-5 h-5" />
                      </div>
                      <p className="font-semibold text-sm">Meus Dados</p>
                    </Link>
                    {painelHref && (
                      <Link
                        href={painelHref}
                        className="flex items-center gap-3 p-4 rounded-xl text-gray-700 hover:bg-gray-50 transition-all"
                      >
                        <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center">
                          <LayoutDashboard className="w-5 h-5" />
                        </div>
                        <p className="font-semibold text-sm">{painelLabel === 'Admin' ? 'Painel Admin' : 'Painel do Professor'}</p>
                      </Link>
                    )}
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-3 p-4 rounded-xl text-red-600 hover:bg-red-50 transition-all w-full"
                    >
                      <div className="w-9 h-9 rounded-lg bg-red-50 text-red-500 flex items-center justify-center">
                        <LogOut className="w-5 h-5" />
                      </div>
                      <p className="font-semibold text-sm">Sair</p>
                    </button>
                  </>
                ) : (
                  <Link
                    href="/admin/login"
                    className="flex items-center gap-3 p-4 rounded-xl text-gray-700 hover:bg-gray-50 transition-all"
                  >
                    <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center">
                      <LogIn className="w-5 h-5" />
                    </div>
                    <p className="font-semibold text-sm">Entrar</p>
                  </Link>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-gray-100">
              <Link
                href="/editais"
                className="flex items-center justify-center gap-2 w-full p-4 rounded-xl bg-hero-gradient text-white font-semibold"
              >
                <Sparkles className="w-5 h-5" />
                Ver todos os Editais
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
