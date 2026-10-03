'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, FileText, FolderOpen, Calendar,
  Newspaper, Users, LogOut, Menu, X, Sparkles, ChevronRight, RefreshCw,
  UserCircle, BarChart3, Trash2, Brain, ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  masterOnly?: boolean;
};

// /admin é exclusivo do Administrador Geral — um Professor (coordenador/vice
// de projeto) nunca renderiza este shell, é redirecionado para /professor
// pelo layout server-side antes disso. Por isso todo item aqui é visto por
// quem chega até aqui (não há mais filtro por papel de "professor").
const NAV_ITEMS: NavItem[] = [
  { href: '/admin',          label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/admin/editais',  label: 'Editais',        icon: FileText },
  { href: '/admin/projetos', label: 'Projetos',       icon: FolderOpen },
  { href: '/admin/agenda',   label: 'Agenda',         icon: Calendar },
  { href: '/admin/posts',    label: 'Posts',          icon: Newspaper },
  { href: '/admin/inscricoes', label: 'Inscrições',  icon: Users },
  { href: '/admin/relatorio', label: 'Relatórios',    icon: BarChart3 },
  { href: '/admin/rag',      label: 'RAG (IFizinha)', icon: Brain, masterOnly: true },
  { href: '/admin/usuarios', label: 'Usuários',       icon: Users, masterOnly: true },
  { href: '/admin/suap',    label: 'Sync SUAP',      icon: RefreshCw, masterOnly: true },
  { href: '/admin/limpar-dados', label: 'Limpar Dados', icon: Trash2, masterOnly: true },
];

function NavLink({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  const pathname = usePathname();
  const isActive = pathname === item.href || (item.href !== '/admin' && pathname?.startsWith(item.href));
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
        isActive
          ? 'bg-white/20 text-white'
          : 'text-white/70 hover:bg-white/10 hover:text-white'
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {item.label}
      {isActive && <ChevronRight className="w-3.5 h-3.5 ml-auto" />}
    </Link>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, isMasterAdmin, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isLoginPage = pathname === '/admin/login';

  useEffect(() => {
    if (!loading && !user && !isLoginPage) {
      router.replace('/admin/login');
    }
  }, [loading, user, isLoginPage, router]);

  // Login page renders without the shell
  if (isLoginPage) return <>{children}</>;

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-hero-gradient flex items-center justify-center">
        <div className="text-white text-center">
          <Sparkles className="w-8 h-8 animate-sparkle mx-auto mb-3" />
          <p className="text-white/80">Carregando...</p>
        </div>
      </div>
    );
  }

  const visibleNav = NAV_ITEMS.filter((item) => !item.masterOnly || isMasterAdmin);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/admin/login');
  };

  const panelTitle = 'Painel Administrativo';

  const Sidebar = ({ onNavClick }: { onNavClick?: () => void }) => (
    <div className="flex flex-col h-full bg-hero-gradient">
      {/* Logo */}
      <div className="p-5 border-b border-white/15">
        <Link href="/admin" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-dourado-500 rounded-lg flex items-center justify-center text-sm font-black text-gray-900 shadow-glow-dourado">
            ✨
          </div>
          <div>
            <p className="text-white font-black text-sm leading-none">Portal Conecta</p>
            <p className="text-white/50 text-xs mt-0.5">{panelTitle}</p>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {visibleNav.map((item) => (
          <NavLink key={item.href} item={item} onClick={onNavClick} />
        ))}
      </nav>

      {/* User info + ações */}
      <div className="p-4 border-t border-white/15">
        {/* Avatar + nome clicável → perfil */}
        <Link
          href="/admin/perfil"
          onClick={onNavClick}
          className="flex items-center gap-3 mb-3 p-2 rounded-xl hover:bg-white/10 transition-colors group"
        >
          {user.photoURL ? (
            <div className="relative w-8 h-8 rounded-full overflow-hidden ring-1 ring-white/20 flex-shrink-0">
              <Image src={user.photoURL} alt="" fill className="object-cover" unoptimized />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              {user.displayName?.charAt(0) ?? user.email?.charAt(0) ?? '?'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-white text-xs font-semibold truncate">
              {user.displayName ?? 'Administrador'}
            </p>
            <p className="text-white/50 text-xs truncate">{user.email}</p>
          </div>
          <UserCircle className="w-4 h-4 text-white/30 group-hover:text-white/60 transition-colors flex-shrink-0" />
        </Link>

        {/* Voltar ao site público — o painel é uma área separada, e sem este
            atalho não havia NENHUM caminho de volta para a home a não ser
            editar a URL na mão. */}
        <Link
          href="/"
          onClick={onNavClick}
          className="flex items-center gap-2 w-full px-3 py-2 mb-1 rounded-xl text-white/70 hover:bg-white/10 hover:text-white transition-all text-sm"
        >
          <ExternalLink className="w-4 h-4" />
          Ver o portal
        </Link>

        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-white/70 hover:bg-white/10 hover:text-white transition-all text-sm"
        >
          <LogOut className="w-4 h-4" />
          Sair
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 flex-shrink-0 fixed top-0 left-0 h-screen z-40">
        <Sidebar />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed top-0 left-0 h-screen w-64 z-50 transition-transform duration-300 md:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onNavClick={() => setMobileOpen(false)} />
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col md:ml-60">
        {/* Mobile topbar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Menu className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-dourado-500 rounded-md flex items-center justify-center text-xs font-black text-gray-900">
              ✨
            </div>
            <p className="font-bold text-gray-900 text-sm">{panelTitle}</p>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className={`ml-auto w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors ${mobileOpen ? 'flex' : 'hidden'}`}
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
