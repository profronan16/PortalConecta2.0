'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCustomToken,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getUserRole, ensureUser } from '@/actions/admin';
import { UserRole } from '@prisma/client';

// ── Tipos públicos ─────────────────────────────────────────────────────────────

export type SuapProfile = {
  name: string;
  email: string;
  username: string;
  fotoUrl: string | null;
};

export type SuapLoginResult =
  | { ok: true; type: 'firebase' }
  | { ok: true; type: 'needs_google_link'; pendingToken: string; suapProfile: SuapProfile }
  | { ok: true; type: 'fallback'; user: { name: string; email: string; username: string } }
  | { ok: false; error: string };

export type CompleteLinkResult =
  | { ok: true }
  | { ok: false; error: string };

// ── Context type ───────────────────────────────────────────────────────────────

type AuthState = {
  user: FirebaseUser | null;
  userRole: UserRole | null;
  supabaseUserId: string | null;
  isMasterAdmin: boolean;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithSuap: (username: string, password: string) => Promise<SuapLoginResult>;
  completeSuapGoogleLink: (pendingToken: string) => Promise<CompleteLinkResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// ── Helper: extrai e-mail do usuário Firebase (inclui claims de custom token) ──
async function extractEmail(firebaseUser: FirebaseUser): Promise<string | null> {
  if (firebaseUser.email) return firebaseUser.email;
  // Custom token users (SUAP) não têm email no objeto user — ler dos claims
  try {
    const tokenResult = await firebaseUser.getIdTokenResult();
    const claimEmail = tokenResult.claims['email'];
    if (typeof claimEmail === 'string' && claimEmail) return claimEmail;
  } catch { /* ignora */ }
  return null;
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // `undefined` = ainda não observamos nenhum estado (primeiro disparo do
  // onAuthStateChanged, na carga inicial da página — não precisa de
  // refresh, o servidor acabou de renderizar). Só refresca a partir da
  // 2ª mudança real de identidade (login, logout, troca de conta).
  const previousUid = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (rawFirebaseUser) => {
      let firebaseUser = rawFirebaseUser;

      // Sincroniza o cookie de sessão server-side (src/lib/session.ts) a
      // cada mudança de estado — login, logout, refresh de token. É o que
      // permite `admin/layout.tsx`/`professor/layout.tsx` verificarem quem
      // está logado ANTES de renderizar, em vez de só no client (achado S9).
      if (firebaseUser) {
        let sessionOk = false;
        try {
          const idToken = await firebaseUser.getIdToken();
          const res = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
          });
          sessionOk = res.ok;
        } catch {
          sessionOk = false;
        }

        if (!sessionOk) {
          // Achado real de segurança: se essa chamada falha (rede, ou o
          // servidor recusa o token) e o navegador já tinha um cookie de
          // sessão de OUTRA conta (ex.: um Admin testando, depois logando
          // como estudante na mesma aba), o cookie antigo continuava
          // válido — o servidor seguia autorizando como o usuário
          // anterior enquanto o cliente já mostrava a conta nova. Falha
          // fechado: limpa o cookie e desloga também no client, em vez de
          // deixar alguém autenticado sem o servidor saber quem é de fato.
          console.error('[AuthContext] Falha ao sincronizar o cookie de sessão — deslogando por segurança.');
          await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => {});
          await firebaseSignOut(auth).catch(() => {});
          firebaseUser = null;
        }
      } else {
        fetch('/api/auth/session', { method: 'DELETE' }).catch(() => {});
      }

      setUser(firebaseUser);

      if (firebaseUser) {
        const email = await extractEmail(firebaseUser);
        if (email) {
          try {
            const { id, role } = await ensureUser(email, firebaseUser.displayName ?? undefined);
            setUserRole(role);
            setSupabaseUserId(id);
          } catch {
            // `ensureUser` (server action) falhou — não há como o cliente
            // saber o papel real sem o servidor, então não assume ADMIN aqui
            // (o servidor de qualquer forma sempre revalida em cada action).
            setUserRole(null);
            setSupabaseUserId(null);
          }
        } else {
          // Usuário autenticado mas sem e-mail em lugar nenhum (não deveria ocorrer)
          setUserRole(null);
          setSupabaseUserId(null);
        }
      } else {
        setUserRole(null);
        setSupabaseUserId(null);
      }

      setLoading(false);

      // Descarta o Router Cache do Next.js sempre que a identidade muda
      // (login, logout, troca de conta) — sem isso, layouts protegidos já
      // renderizados (ex.: admin/(protected)/layout.tsx) podem ser
      // reaproveitados em navegações client-side seguintes (via <Link> ou
      // router.replace) mesmo depois de trocar de usuário na mesma aba,
      // sem re-executar a checagem de sessão no servidor. Foi assim que um
      // estudante conseguiu ver o painel admin: o layout já tinha sido
      // renderizado autorizado pra sessão anterior e ficou em cache.
      const currentUid = firebaseUser?.uid ?? null;
      if (previousUid.current !== undefined && previousUid.current !== currentUid) {
        router.refresh();
      }
      previousUid.current = currentUid;
    });
    return unsubscribe;
  }, [router]);

  // ── signIn email/senha ───────────────────────────────────────────────────────
  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  // ── signIn Google ────────────────────────────────────────────────────────────
  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  // ── signIn SUAP ──────────────────────────────────────────────────────────────
  const signInWithSuap = async (username: string, password: string): Promise<SuapLoginResult> => {
    const res = await fetch('/api/auth/suap-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json() as {
      customToken?: string;
      needsGoogleLink?: boolean;
      pendingToken?: string;
      suapProfile?: SuapProfile;
      fallback?: boolean;
      user?: { name: string; email: string; username: string };
      error?: string;
    };

    if (!res.ok) return { ok: false, error: data.error ?? 'Falha no login SUAP.' };

    // Primeira vez — precisa vincular Google
    if (data.needsGoogleLink && data.pendingToken && data.suapProfile) {
      return { ok: true, type: 'needs_google_link', pendingToken: data.pendingToken, suapProfile: data.suapProfile };
    }

    // Login completo via Firebase Custom Token
    if (data.customToken) {
      await signInWithCustomToken(auth, data.customToken);
      return { ok: true, type: 'firebase' };
    }

    // Fallback sem Firebase Admin
    if (data.fallback && data.user) {
      return { ok: true, type: 'fallback', user: data.user };
    }

    return { ok: false, error: 'Resposta inesperada do servidor.' };
  };

  // ── Completar vínculo SUAP + Google ─────────────────────────────────────────
  //
  // IMPORTANTE: signInWithPopup muda o estado do Firebase imediatamente,
  // o que dispararia o redirect automático da página de login.
  // A página de login deve setar `linkingInProgress = true` ANTES de chamar
  // esta função para bloquear esse redirect.
  //
  // Após o vínculo inicial, o usuário FICA como sessão Google (não troca
  // por custom token), pois a sessão Google já tem email e funciona normalmente.
  // Logins SUAP subsequentes usam custom token (já linked = true no banco).
  //
  const completeSuapGoogleLink = async (pendingToken: string): Promise<CompleteLinkResult> => {
    try {
      // 1. Popup Google → assina no Firebase como usuário Google
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const firebaseIdToken = await result.user.getIdToken();

      // 2. Enviar ao servidor: validar token temporário SUAP + salvar vínculo no banco
      const res = await fetch('/api/auth/complete-suap-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingToken, firebaseIdToken }),
      });

      const data = await res.json() as { customToken?: string; error?: string };

      if (!res.ok) {
        // Falhou no servidor — desfaz o sign-in do Google e retorna erro
        await firebaseSignOut(auth);
        return { ok: false, error: data.error ?? 'Erro ao vincular conta.' };
      }

      // 3. Vínculo salvo com sucesso.
      //    O usuário está logado como Google user — isso é suficiente para o painel.
      //    Fazemos um refresh do role pois o complete-suap-link pode ter promovido
      //    o usuário para PROFESSOR (o onAuthStateChanged já rodou com ESTUDANTE).
      try {
        const { id, role } = await ensureUser(result.user.email!, result.user.displayName ?? undefined);
        setUserRole(role);
        setSupabaseUserId(id);
      } catch { /* ignora — o role será correto no próximo login */ }

      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido.';
      if (message.includes('popup-closed') || message.includes('cancelled')) {
        return { ok: false, error: 'Login com Google cancelado. É necessário vincular para continuar.' };
      }
      return { ok: false, error: message };
    }
  };

  // ── signOut ──────────────────────────────────────────────────────────────────
  const signOut = async () => {
    await firebaseSignOut(auth);
    setUserRole(null);
    setSupabaseUserId(null);
  };

  // `role` já vem calculado ao vivo do servidor (ensureUser → resolveUserRole,
  // ver src/lib/permissions.ts): só o Administrador Geral (ADMIN_EMAILS) pode
  // ser ADMIN, então "isMasterAdmin" e "role === ADMIN" são a mesma coisa.
  // Antes, isMasterAdmin comparava `user?.email` com `process.env.ADMIN_EMAILS`
  // lido aqui num componente client — essa env var não é NEXT_PUBLIC_, então
  // no navegador ela sempre vinha `undefined` e isMasterAdmin nunca era
  // `true` pra ninguém (nem pro próprio Administrador Geral), escondendo RAG,
  // Sync SUAP, Usuários e Limpar Dados mesmo para quem tinha permissão.
  const isAdmin = userRole === 'ADMIN';
  const isMasterAdmin = isAdmin;

  return (
    <AuthContext.Provider value={{
      user, userRole, supabaseUserId,
      isMasterAdmin, isAdmin, loading,
      signIn, signInWithGoogle, signInWithSuap,
      completeSuapGoogleLink, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
