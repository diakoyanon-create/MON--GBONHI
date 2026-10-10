import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary';
import { authRedirectTarget } from './lib/authRedirect';
import { installChunkReload, registerServiceWorker } from './lib/pwa';

// Lien d'invitation ou de réinitialisation : la personne doit d'abord choisir son mot de passe.
const target = authRedirectTarget(window.location);
if (target) window.history.replaceState(null, '', target);

installChunkReload();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);

registerServiceWorker();
