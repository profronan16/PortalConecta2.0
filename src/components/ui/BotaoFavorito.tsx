'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { alternarFavorito, listarIdsFavoritos } from '@/actions/favoritos';
import { chaveFavorito, type EntidadeFavoritavel } from '@/lib/minha-area';

/**
 * Botão de favoritar (ROADMAP 6.3) — usado nas páginas de projeto e edital.
 *
 * Sem login não tenta favoritar: leva o visitante para a área do estudante,
 * porque favorito sem conta não teria onde ser guardado.
 */
export function BotaoFavorito({
  entidade,
  entidadeId,
  variante = 'claro',
}: {
  entidade: EntidadeFavoritavel;
  entidadeId: string;
  /** `claro` = fundo claro (páginas internas), `escuro` = sobre o hero colorido. */
  variante?: 'claro' | 'escuro';
}) {
  const { user } = useAuth();
  const [favoritado, setFavoritado] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [pronto, setPronto] = useState(false);

  const chave = chaveFavorito(entidade, entidadeId);

  useEffect(() => {
    let ativo = true;
    if (!user) {
      setPronto(true);
      return;
    }

    user
      .getIdToken()
      .then(listarIdsFavoritos)
      .then((ids) => {
        if (ativo) setFavoritado(ids.includes(chave));
      })
      .catch(() => undefined)
      .finally(() => {
        if (ativo) setPronto(true);
      });

    return () => { ativo = false; };
  }, [user, chave]);

  const alternar = async () => {
    if (!user) return;
    setCarregando(true);
    try {
      const idToken = await user.getIdToken();
      const result = await alternarFavorito(idToken, entidade, entidadeId);
      if (result.ok) setFavoritado(result.favoritado);
    } finally {
      setCarregando(false);
    }
  };

  const base = 'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all';
  const estilo = favoritado
    ? 'bg-rosa-vibrante text-white hover:bg-rosa-vibrante/90'
    : variante === 'escuro'
    ? 'bg-white/15 text-white border border-white/30 hover:bg-white/25'
    : 'border border-gray-200 text-gray-700 hover:bg-gray-50';

  if (!user) {
    return (
      <Link
        href="/minha-area"
        title="Entre para salvar nos favoritos"
        className={`${base} ${variante === 'escuro' ? 'bg-white/15 text-white border border-white/30 hover:bg-white/25' : 'border border-gray-200 text-gray-500 hover:bg-gray-50'}`}
      >
        <Heart className="w-4 h-4" />
        Favoritar
      </Link>
    );
  }

  return (
    <button
      onClick={alternar}
      disabled={carregando || !pronto}
      aria-pressed={favoritado}
      title={favoritado ? 'Remover dos favoritos' : 'Salvar nos favoritos'}
      className={`${base} ${estilo} disabled:opacity-60`}
    >
      {carregando ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Heart className={`w-4 h-4 ${favoritado ? 'fill-current' : ''}`} />
      )}
      {favoritado ? 'Salvo' : 'Favoritar'}
    </button>
  );
}
