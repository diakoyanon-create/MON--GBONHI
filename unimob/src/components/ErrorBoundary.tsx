import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, reloadOnceForNewVersion } from '@/lib/pwa';

type State = { error: Error | null };

/** Évite l'écran blanc : message clair et bouton de rechargement. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) reloadOnceForNewVersion();
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const update = isChunkLoadError(this.state.error);
    return (
      <div role="alert" className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="card max-w-md p-6 text-center">
          <h1 className="text-lg font-semibold">{update ? 'Une nouvelle version est disponible' : 'Une erreur est survenue'}</h1>
          <p className="mt-2 text-sm text-ink-500">
            {update ? 'Rechargez la page pour utiliser la dernière version.' : 'Rechargez la page. Si le problème persiste, contactez l’administrateur.'}
          </p>
          <button className="btn-primary mt-4" onClick={() => window.location.reload()}>Recharger</button>
        </div>
      </div>
    );
  }
}
