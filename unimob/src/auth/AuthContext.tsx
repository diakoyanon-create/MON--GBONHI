import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '@/lib/supabase';

export type AppRole = 'admin' | 'agent' | 'assistant' | 'comptable';
export type Profile = { id: string; full_name: string; email: string | null; role: AppRole | null; is_active: boolean };

export type Permissions = {
  staff: boolean;
  admin: boolean;
  sales: boolean; // biens, contacts, visites
  negotiate: boolean; // transactions, offres
  finance: boolean; // recettes, dépenses, commissions
};

/** Miroir des fonctions SQL can_sales(), can_finance()… (la base reste l'autorité). */
export function permissionsFor(profile: Pick<Profile, 'role' | 'is_active'> | null): Permissions {
  const role = profile?.is_active ? profile.role : null;
  return {
    staff: role !== null,
    admin: role === 'admin',
    sales: role === 'admin' || role === 'agent' || role === 'assistant',
    negotiate: role === 'admin' || role === 'agent',
    finance: role === 'admin' || role === 'comptable',
  };
}

type AuthState = {
  loading: boolean;
  /** Le profil n'a pas pu être chargé (réseau) : ne pas conclure à un compte non activé. */
  profileError: boolean;
  session: Session | null;
  profile: Profile | null;
  can: Permissions;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(supabaseConfigured);
  const [profileError, setProfileError] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Charge le profil. En cas d'échec réseau, le profil courant est CONSERVÉ et une nouvelle
   * tentative est programmée : une coupure passagère ne doit pas éjecter l'utilisateur
   * de l'espace privé ni lui faire perdre sa saisie.
   */
  const loadProfile = useCallback(async (s: Session | null, attempt = 0): Promise<void> => {
    if (retryRef.current) clearTimeout(retryRef.current);
    if (!s) {
      userIdRef.current = null;
      setProfile(null);
      return;
    }
    const { data, error } = await supabase.from('profiles').select('id, full_name, email, role, is_active').eq('id', s.user.id).maybeSingle();
    if (error) {
      setProfileError(true);
      if (attempt < 5) retryRef.current = setTimeout(() => void loadProfile(s, attempt + 1), 2000 * (attempt + 1));
      return;
    }
    userIdRef.current = s.user.id;
    setProfileError(false);
    setProfile((data as Profile | null) ?? null);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Rafraîchissement de jeton ou retour au premier plan pour le même utilisateur :
      // inutile de recharger le profil. Différé : pas d'appel Supabase dans le callback.
      const sameUser = s?.user.id && s.user.id === userIdRef.current;
      if (sameUser && event !== 'USER_UPDATED') return;
      setTimeout(() => void loadProfile(s), 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return error.message.includes('Invalid login') ? 'Identifiants incorrects.' : 'Connexion impossible pour le moment.';
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    userIdRef.current = null;
    setProfile(null);
    setSession(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading, profileError, session, profile, can: permissionsFor(profile), signIn, signOut,
      refreshProfile: () => loadProfile(session),
    }),
    [loading, profileError, session, profile, signIn, signOut, loadProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}

export { AuthContext };
