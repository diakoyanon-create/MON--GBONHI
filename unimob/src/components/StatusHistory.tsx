import { listRows } from '@/api/crud';
import { useQuery } from '@/api/hooks';
import { formatDateTime } from '@/lib/format';
import { label } from '@/domain/labels';
import { Section, Spinner } from './ui';

export function StatusHistory({ entityType, entityId, map }: { entityType: string; entityId: string; map: Record<string, string> }) {
  const { data, loading } = useQuery(
    () => listRows('status_history', { eq: { entity_type: entityType, entity_id: entityId }, order: { column: 'changed_at', ascending: false }, pageSize: 50 }),
    [entityType, entityId],
  );
  return (
    <Section title="Historique des statuts">
      {loading ? <Spinner /> : !data?.rows.length ? <p className="text-sm text-ink-500">Aucun changement enregistré.</p> : (
        <ol className="space-y-1.5 text-sm">
          {data.rows.map((h) => (
            <li key={h.id} className="flex flex-wrap gap-x-2">
              <span className="text-ink-500 tabular-nums">{formatDateTime(h.changed_at)}</span>
              <span>{h.old_status ? `${label(map, h.old_status)} → ` : 'Création : '}<strong>{label(map, h.new_status)}</strong></span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
