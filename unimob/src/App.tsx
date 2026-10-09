import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthContext';
import { RequireStaff } from '@/auth/RequireStaff';
import { Spinner } from '@/components/ui';
import { PublicLayout } from '@/layouts/PublicLayout';
import { supabaseConfigured } from '@/lib/supabase';
import { AboutPage, CatalogPage, ContactPage, HomePage, LegalPage, NotFoundPage, PropertyPage } from '@/pages/public/PublicPages';
import { ForgotPasswordPage, LoginPage, UpdatePasswordPage } from '@/pages/auth/LoginPage';

// L'espace privé est chargé à la demande : les visiteurs du site ne téléchargent pas son code.
const AdminRoutes = lazy(() => import('./AdminRoutes'));

export default function App() {
  if (!supabaseConfigured) return <SetupScreen />;
  return (
    <AuthProvider>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<HomePage />} />
          <Route path="biens" element={<CatalogPage />} />
          <Route path="biens/:reference" element={<PropertyPage />} />
          <Route path="a-propos" element={<AboutPage />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="mentions-legales" element={<LegalPage kind="mentions" />} />
          <Route path="confidentialite" element={<LegalPage kind="confidentialite" />} />
        </Route>
        <Route path="connexion" element={<LoginPage />} />
        <Route path="mot-de-passe-oublie" element={<ForgotPasswordPage />} />
        <Route path="mot-de-passe" element={<UpdatePasswordPage />} />
        <Route
          path="admin/*"
          element={
            <RequireStaff>
              <Suspense fallback={<div className="p-8"><Spinner /></div>}>
                <AdminRoutes />
              </Suspense>
            </RequireStaff>
          }
        />
        <Route element={<PublicLayout />}>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

function SetupScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card max-w-lg p-6">
        <h1 className="font-display text-xl">Configuration requise</h1>
        <p className="mt-2 text-sm text-ink-700">
          Copiez <code>.env.example</code> en <code>.env.local</code> et renseignez <code>VITE_SUPABASE_URL</code> et
          <code> VITE_SUPABASE_ANON_KEY</code> (clé publique « anon » uniquement), puis relancez l’application.
        </p>
        <p className="mt-2 text-sm text-ink-500">Voir docs/INSTALLATION.md.</p>
      </div>
    </div>
  );
}
