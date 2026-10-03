'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Heart, Bell, BellRing, Target, Check, Trash2, ExternalLink,
  AlertCircle, Loader2, Mail, MonitorSmartphone, CheckCheck,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { listarMeusFavoritos, removerFavorito, type FavoritoItem } from '@/actions/favoritos';
import {
  listarMinhasNotificacoes, marcarNotificacaoLida, marcarTodasNotificacoesLidas,
  type NotificacaoItem,
} from '@/actions/notificacoes';
import {
  listarMeusAlertas, salvarMeuAlerta, removerMeuAlerta, type AlertaItem,
} from '@/actions/alertas';
import {
  CATEGORIAS_ALERTA, CANAIS_ALERTA, ROTULO_CATEGORIA, ROTULO_ENTIDADE,
  formatarTempoRelativo, contarNaoLidas, type CanalAlerta,
} from '@/lib/minha-area';

/**
 * Área do estudante (ROADMAP 6.2, 6.3 e 6.4): favoritos, notificações e
 * alertas de interesse em uma única página com abas.
 *
 * Fica em uma página só porque as três coisas respondem à mesma pergunta
 * ("o que eu estou acompanhando?"), e porque assim o sino do cabeçalho tem um
 * destino único.
 */

type Aba = 'favoritos' | 'notificacoes' | 'alertas';

const ABAS: { id: Aba; label: string; icon: React.ElementType }[] = [
  { id: 'favoritos', label: 'Favoritos', icon: Heart },
  { id: 'notificacoes', label: 'Notificações', icon: Bell },
  { id: 'alertas', label: 'Alertas', icon: Target },
];

const ROTULO_CANAL: Record<CanalAlerta, string> = {
  portal: 'Avisos no portal',
  email: 'E-mail',
};

export default function MinhaAreaPage() {
  const { user } = useAuth();
  const [aba, setAba] = useState<Aba>('favoritos');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [favoritos, setFavoritos] = useState<FavoritoItem[]>([]);
  const [notificacoes, setNotificacoes] = useState<NotificacaoItem[]>([]);
  const [alertas, setAlertas] = useState<AlertaItem[]>([]);

  // O sino do cabeçalho chega por /minha-area#notificacoes.
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'notificacoes' || hash === 'alertas' || hash === 'favoritos') {
      setAba(hash);
    }
  }, []);

  const carregar = useCallback(async () => {
    if (!user) return;
    setCarregando(true);
    setErro('');
    try {
      const idToken = await user.getIdToken();
      const [f, n, a] = await Promise.all([
        listarMeusFavoritos(idToken),
        listarMinhasNotificacoes(idToken),
        listarMeusAlertas(idToken),
      ]);
      setFavoritos(f);
      setNotificacoes(n);
      setAlertas(a);
    } catch {
      setErro('Não foi possível carregar seus dados agora. Tente novamente.');
    } finally {
      setCarregando(false);
    }
  }, [user]);

  useEffect(() => { carregar(); }, [carregar]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <h1 className="text-xl font-black text-gray-900 mb-2">Entre para ver sua área</h1>
          <p className="text-gray-500 text-sm mb-6">
            Favoritos, notificações e alertas ficam vinculados à sua conta.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-hero-gradient text-white font-semibold px-6 py-3 rounded-xl hover:opacity-90 transition-all"
          >
            Voltar para a home
          </Link>
        </div>
      </div>
    );
  }

  const naoLidas = contarNaoLidas(notificacoes);

  return (
    <div className="min-h-screen bg-gray-50 pt-24 pb-16">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-black text-gray-900">Minha área</h1>
          <p className="text-gray-500 text-sm mt-1">
            Acompanhe o que você salvou, recebeu e pediu para ser avisado.
          </p>
        </div>

        {/* Abas */}
        <div className="flex gap-1.5 mb-6 bg-white rounded-2xl border border-gray-100 p-1.5">
          {ABAS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setAba(id)}
              aria-current={aba === id ? 'page' : undefined}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                aba === id ? 'bg-hero-gradient text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              {id === 'notificacoes' && naoLidas > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  aba === id ? 'bg-white/25 text-white' : 'bg-red-100 text-red-700'
                }`}>
                  {naoLidas}
                </span>
              )}
            </button>
          ))}
        </div>

        {erro && (
          <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {erro}
          </div>
        )}

        {carregando ? (
          <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Carregando...
          </div>
        ) : (
          <>
            {aba === 'favoritos' && (
              <AbaFavoritos
                favoritos={favoritos}
                onRemover={async (item) => {
                  const idToken = await user.getIdToken();
                  await removerFavorito(idToken, item.entidade, item.entidadeId);
                  setFavoritos((prev) => prev.filter((f) => f.chave !== item.chave));
                }}
              />
            )}

            {aba === 'notificacoes' && (
              <AbaNotificacoes
                notificacoes={notificacoes}
                onMarcarLida={async (id) => {
                  const idToken = await user.getIdToken();
                  await marcarNotificacaoLida(idToken, id);
                  setNotificacoes((prev) => prev.map((n) => (n.id === id ? { ...n, lida: true } : n)));
                }}
                onMarcarTodas={async () => {
                  const idToken = await user.getIdToken();
                  await marcarTodasNotificacoesLidas(idToken);
                  setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: true })));
                }}
              />
            )}

            {aba === 'alertas' && (
              <AbaAlertas
                alertas={alertas}
                onSalvar={async (canal, categorias, ativo) => {
                  const idToken = await user.getIdToken();
                  const result = await salvarMeuAlerta(idToken, { canal, categorias, ativo });
                  if (!result.ok) return result.error;
                  setAlertas((prev) => {
                    const outros = prev.filter((a) => a.canal !== canal);
                    return [...outros, result.alerta];
                  });
                  return null;
                }}
                onRemover={async (canal) => {
                  const idToken = await user.getIdToken();
                  await removerMeuAlerta(idToken, canal);
                  setAlertas((prev) => prev.filter((a) => a.canal !== canal));
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Favoritos ────────────────────────────────────────────────────────────────

function AbaFavoritos({
  favoritos,
  onRemover,
}: {
  favoritos: FavoritoItem[];
  onRemover: (item: FavoritoItem) => Promise<void>;
}) {
  if (favoritos.length === 0) {
    return (
      <Vazio
        icon={Heart}
        titulo="Nenhum favorito ainda"
        texto="Use o coração nas páginas de projetos e editais para salvar aqui."
        href="/projetos"
        hrefLabel="Ver projetos"
      />
    );
  }

  return (
    <div className="space-y-3">
      {favoritos.map((item) => (
        <div
          key={item.chave}
          className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-4"
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0"
            style={{ backgroundColor: item.cor ?? '#2F52D3' }}
          >
            {item.titulo.charAt(0)}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-400 font-medium">{ROTULO_ENTIDADE[item.entidade]}</p>
            <Link
              href={item.href}
              className="font-semibold text-gray-900 text-sm hover:text-azul-eletrico transition-colors line-clamp-1"
            >
              {item.titulo}
            </Link>
            {item.subtitulo && <p className="text-xs text-gray-500">{item.subtitulo}</p>}
            {!item.disponivel && (
              <p className="text-xs text-amber-600 mt-0.5">Indisponível — saiu do ar</p>
            )}
          </div>

          <Link
            href={item.href}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-50 hover:text-azul-eletrico transition-colors"
            title="Abrir"
          >
            <ExternalLink className="w-4 h-4" />
          </Link>
          <button
            onClick={() => onRemover(item)}
            className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
            title="Remover dos favoritos"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Notificações ─────────────────────────────────────────────────────────────

function AbaNotificacoes({
  notificacoes,
  onMarcarLida,
  onMarcarTodas,
}: {
  notificacoes: NotificacaoItem[];
  onMarcarLida: (id: string) => Promise<void>;
  onMarcarTodas: () => Promise<void>;
}) {
  if (notificacoes.length === 0) {
    return (
      <Vazio
        icon={Bell}
        titulo="Nenhuma notificação"
        texto="Você será avisado aqui quando suas inscrições mudarem de status ou quando um edital que você acompanha for publicado."
        href="/editais"
        hrefLabel="Ver editais"
      />
    );
  }

  const naoLidas = contarNaoLidas(notificacoes);

  return (
    <div className="space-y-3">
      {naoLidas > 0 && (
        <div className="flex justify-end">
          <button
            onClick={onMarcarTodas}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-azul-eletrico hover:underline"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Marcar todas como lidas ({naoLidas})
          </button>
        </div>
      )}

      {notificacoes.map((n) => (
        <div
          key={n.id}
          className={`rounded-2xl border p-4 flex items-start gap-3 ${
            n.lida ? 'bg-white border-gray-100' : 'bg-azul-eletrico/5 border-azul-eletrico/20'
          }`}
        >
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            n.lida ? 'bg-gray-100 text-gray-400' : 'bg-azul-eletrico/10 text-azul-eletrico'
          }`}>
            {n.lida ? <Bell className="w-4 h-4" /> : <BellRing className="w-4 h-4" />}
          </div>

          <div className="min-w-0 flex-1">
            <p className="font-semibold text-gray-900 text-sm">{n.titulo}</p>
            {n.texto && <p className="text-sm text-gray-600 mt-0.5">{n.texto}</p>}
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-xs text-gray-400">{formatarTempoRelativo(n.created_at)}</span>
              {n.link && (
                <Link href={n.link} className="text-xs font-semibold text-azul-eletrico hover:underline">
                  Abrir
                </Link>
              )}
            </div>
          </div>

          {!n.lida && (
            <button
              onClick={() => onMarcarLida(n.id)}
              className="p-2 rounded-lg text-gray-400 hover:bg-gray-50 hover:text-green-600 transition-colors"
              title="Marcar como lida"
            >
              <Check className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Alertas ──────────────────────────────────────────────────────────────────

function AbaAlertas({
  alertas,
  onSalvar,
  onRemover,
}: {
  alertas: AlertaItem[];
  onSalvar: (canal: CanalAlerta, categorias: string[], ativo: boolean) => Promise<string | null>;
  onRemover: (canal: CanalAlerta) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Escolha as categorias de edital que te interessam. Sem nenhuma marcada, você recebe
        avisos de <strong>todas</strong> as categorias.
      </p>

      {CANAIS_ALERTA.map((canal) => (
        <CartaoAlerta
          key={canal}
          canal={canal}
          alerta={alertas.find((a) => a.canal === canal)}
          onSalvar={onSalvar}
          onRemover={onRemover}
        />
      ))}
    </div>
  );
}

function CartaoAlerta({
  canal,
  alerta,
  onSalvar,
  onRemover,
}: {
  canal: CanalAlerta;
  alerta?: AlertaItem;
  onSalvar: (canal: CanalAlerta, categorias: string[], ativo: boolean) => Promise<string | null>;
  onRemover: (canal: CanalAlerta) => Promise<void>;
}) {
  const [categorias, setCategorias] = useState<string[]>(alerta?.categorias ?? []);
  const [ativo, setAtivo] = useState(alerta?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  // O cartão é montado antes de os alertas chegarem (carregamento assíncrono).
  useEffect(() => {
    if (alerta) {
      setCategorias(alerta.categorias);
      setAtivo(alerta.ativo);
    }
  }, [alerta]);

  const alternarCategoria = (categoria: string) => {
    setCategorias((prev) =>
      prev.includes(categoria) ? prev.filter((c) => c !== categoria) : [...prev, categoria],
    );
  };

  const salvar = async () => {
    setSalvando(true);
    setMensagem('');
    const erro = await onSalvar(canal, categorias, ativo);
    setMensagem(erro ?? 'Alerta salvo!');
    setSalvando(false);
  };

  const Icone = canal === 'email' ? Mail : MonitorSmartphone;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-roxo-luminoso/10 text-roxo-luminoso flex items-center justify-center">
            <Icone className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900 text-sm">{ROTULO_CANAL[canal]}</h2>
            <p className="text-xs text-gray-500">
              {canal === 'email'
                ? 'Avisamos por e-mail quando um edital da sua lista for publicado.'
                : 'Avisos aparecem no sino de notificações aqui no portal.'}
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
            className="w-4 h-4 accent-azul-eletrico"
          />
          <span className="text-xs font-semibold text-gray-600">Ativo</span>
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {CATEGORIAS_ALERTA.map((categoria) => {
          const marcada = categorias.includes(categoria);
          return (
            <button
              key={categoria}
              type="button"
              onClick={() => alternarCategoria(categoria)}
              aria-pressed={marcada}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                marcada
                  ? 'bg-azul-eletrico text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {ROTULO_CATEGORIA[categoria]}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={salvar}
          disabled={salvando}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-azul-eletrico text-white text-sm font-semibold hover:bg-azul-eletrico/90 transition-colors disabled:opacity-60"
        >
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Salvar
        </button>

        {alerta && (
          <button
            onClick={() => onRemover(canal)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Desativar
          </button>
        )}

        {mensagem && <span className="text-xs text-gray-500">{mensagem}</span>}
      </div>
    </div>
  );
}

// ─── Estado vazio ─────────────────────────────────────────────────────────────

function Vazio({
  icon: Icon,
  titulo,
  texto,
  href,
  hrefLabel,
}: {
  icon: React.ElementType;
  titulo: string;
  texto: string;
  href: string;
  hrefLabel: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 text-center py-16 px-6">
      <Icon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
      <p className="font-bold text-gray-900">{titulo}</p>
      <p className="text-sm text-gray-500 max-w-sm mx-auto mt-1 mb-5">{texto}</p>
      <Link
        href={href}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
      >
        {hrefLabel}
      </Link>
    </div>
  );
}
