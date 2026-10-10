import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { ErrorBox, Spinner, SuccessBox } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSeo } from '@/lib/seo';

export function LoginPage() {
  const { session, can, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/admin';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useSeo({ title: 'Connexion', noindex: true });

  if (session && can.staff) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signIn(email, password);
    setBusy(false);
    if (err) setError(err);
    else navigate(from, { replace: true });
  }

  return (
    <AuthCard title="Connexion à l’espace privé">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">Adresse électronique</label>
          <input id="email" type="email" autoComplete="username" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">Mot de passe</label>
          <input id="password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        <p className="text-center text-sm"><Link className="text-gold-700 underline" to="/mot-de-passe-oublie">Mot de passe oublié ?</Link></p>
        <p className="text-center text-xs text-ink-500">Aucune inscription publique : les comptes sont créés par l’administrateur.</p>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useSeo({ title: 'Mot de passe oublié', noindex: true });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/mot-de-passe`,
    });
    // Message identique que le compte existe ou non (pas d'énumération des comptes).
    if (err && /rate limit/i.test(err.message)) setError('Trop de tentatives. Réessayez dans quelques minutes.');
    else setSent(true);
  }
  return (
    <AuthCard title="Réinitialiser le mot de passe">
      {sent ? (
        <SuccessBox>Si un compte correspond à cette adresse, un lien de réinitialisation vient d’être envoyé.</SuccessBox>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Adresse électronique</label>
            <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <ErrorBox error={error} />
          <button className="btn-primary w-full">Envoyer le lien</button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link className="text-gold-700 underline" to="/connexion">Retour à la connexion</Link></p>
    </AuthCard>
  );
}

export function UpdatePasswordPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [error, setError] = useState<string | null>(null);
  useSeo({ title: 'Nouveau mot de passe', noindex: true });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(pwd, pwd2);
    if (problem) return setError(problem);
    const { error: err } = await supabase.auth.updateUser({ password: pwd });
    if (err) setError('Impossible de mettre à jour le mot de passe. Le lien a peut-être expiré.');
    else navigate('/admin', { replace: true });
  }
  return (
    <AuthCard title="Choisir votre mot de passe">
      {loading ? (
        <Spinner label="Vérification du lien…" />
      ) : !session ? (
        <ErrorBox error="Lien invalide ou expiré. Recommencez la procédure de réinitialisation." />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="p1">Nouveau mot de passe</label>
            <input id="p1" type="password" autoComplete="new-password" className="input" value={pwd} onChange={(e) => setPwd(e.target.value)} />
            <p className="mt-1 text-xs text-ink-500">12 caractères minimum, avec lettres et chiffres.</p>
          </div>
          <div>
            <label className="label" htmlFor="p2">Confirmation</label>
            <input id="p2" type="password" autoComplete="new-password" className="input" value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
          </div>
          <ErrorBox error={error} />
          <button className="btn-primary w-full">Enregistrer</button>
        </form>
      )}
    </AuthCard>
  );
}

export function passwordProblem(pwd: string, confirm: string): string | null {
  if (pwd.length < 12) return 'Le mot de passe doit contenir au moins 12 caractères.';
  if (!/[a-zA-Z]/.test(pwd) || !/\d/.test(pwd)) return 'Le mot de passe doit contenir des lettres et des chiffres.';
  if (pwd !== confirm) return 'Les deux mots de passe ne correspondent pas.';
  return null;
}

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-900 p-4">
      <div className="card w-full max-w-sm p-6">
        <Link to="/" className="font-display text-sm text-gold-700">← Retour au site</Link>
        <h1 className="mt-3 mb-5 font-display text-xl">{title}</h1>
        {children}
      </div>
    </div>
  );
}
