'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { contarMinhasNaoLidas } from '@/actions/notificacoes';
import { rotuloContadorNaoLidas } from '@/lib/minha-area';

/**
 * Sino de notificações do cabeçalho (ROADMAP 6.2).
 *
 * Carrega só o CONTADOR (barato) e leva para /minha-area#notificacoes, onde a
 * lista completa é carregada. Não busca nada para visitante sem login.
 */
export function NotificationBell({ tom = 'claro' }: { tom?: 'claro' | 'escuro' }) {
  const { user } = useAuth();
  const [naoLidas, setNaoLidas] = useState(0);

  useEffect(() => {
    let ativo = true;
    if (!user) {
      setNaoLidas(0);
      return;
    }

    user
      .getIdToken()
      .then(contarMinhasNaoLidas)
      .then((total) => { if (ativo) setNaoLidas(total); })
      .catch(() => undefined);

    return () => { ativo = false; };
  }, [user]);

  if (!user) return null;

  const rotulo = rotuloContadorNaoLidas(naoLidas);

  return (
    <Link
      href="/minha-area#notificacoes"
      title={naoLidas > 0 ? `${naoLidas} notificação(ões) não lida(s)` : 'Notificações'}
      className={`relative p-2 rounded-lg transition-colors ${
        tom === 'escuro' ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      <Bell className="w-5 h-5" />
      {rotulo && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
          {rotulo}
        </span>
      )}
    </Link>
  );
}
