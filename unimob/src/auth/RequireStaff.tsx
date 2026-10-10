import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, type Permissions } from './AuthContext';
import { Spinner } from '@/components/ui';

/** Protège l'espace privé : session + rôle actif obligatoires (la base applique aussi RLS). */
export function RequireStaff({ children, need }: { children: ReactNode; need?: keyof Permissions }) {
  const { loading, profileError, session, profile, can, signOut } = useAuth();
  const location = useLocation();
  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  if (!session) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (!profile && profileError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
        <Spinner label="Connexion au serveur impossible pour le moment, nouvelle tentative…" />
        <button className="btn-outline btn-sm" onClick={() => window.location.reload()}>Réessayer maintenant</button>
      </div>
    );
  }
  if (!profile || !can.staff) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="card max-w-md p-6 text-center">
          <h1 className="text-lg font-semibold">Accès non autorisé</h1>
          <p className="mt-2 text-sm text-ink-500">
            Votre compte n’a pas encore été activé par un administrateur. Aucune donnée privée n’est accessible.
          </p>
          <button className="btn-outline mt-4" onClick={() => void signOut()}>Se déconnecter</button>
        </div>
      </div>
    );
  }
  if (need && !can[need]) {
    return (
      <div className="card p-6">
        <h1 className="text-lg font-semibold">Accès réservé</h1>
        <p className="mt-2 text-sm text-ink-500">Votre rôle ne permet pas d’accéder à cette section.</p>
      </div>
    );
  }
  return <>{children}</>;
}
