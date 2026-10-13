import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { humanError } from '@/components/ui';

/** Exécute une requête asynchrone et expose { data, error, loading, reload }. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fnRef.current()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(humanError(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export type AgencySettings = Record<string, any> & {
  agency_name: string;
  whatsapp_number: string | null;
  whatsapp_message_template: string;
  contact_sources?: string[];
  expense_categories?: string[];
  task_categories?: string[];
  zones_served: string[];
};

const FALLBACK: AgencySettings = {
  agency_name: 'Mon Agence Immobilière',
  whatsapp_number: null,
  whatsapp_message_template: 'Bonjour, je suis intéressé(e) par le bien référence {reference}.',
  zones_served: [],
  inquiry_consent_text: "J'accepte que l'agence utilise ces informations pour répondre à ma demande.",
};

let publicCache: Promise<AgencySettings> | null = null;
/** Informations publiques de l'agence (vue public_agency_info). */
export function fetchPublicAgency(): Promise<AgencySettings> {
  // En cas d'échec (réseau), on ne garde pas le repli en cache : le prochain appel réessaie.
  publicCache ??= Promise.resolve(supabase.from('public_agency_info').select('*').maybeSingle()).then(
    ({ data, error }) => {
      if (error) {
        publicCache = null;
        return FALLBACK;
      }
      return { ...FALLBACK, ...(data ?? {}) } as AgencySettings;
    },
    () => {
      publicCache = null;
      return FALLBACK;
    },
  );
  return publicCache;
}
export function resetPublicAgencyCache() {
  publicCache = null;
}

export function usePublicAgency() {
  return useQuery(fetchPublicAgency, []);
}

/** Paramètres complets (réservés à l'équipe). */
export function useAgencySettings() {
  return useQuery(async () => {
    const { data, error } = await supabase.from('agency_settings').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    return { ...FALLBACK, ...(data ?? {}) } as AgencySettings;
  }, []);
}
