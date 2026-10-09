import { useState } from 'react';
import { listRows } from '@/api/crud';
import { useQuery } from '@/api/hooks';
import { CHANNELS, label, options } from '@/domain/labels';
import { formatDateTime } from '@/lib/format';
import { ResourceForm } from '@/resources/ResourceForm';
import type { FieldDef } from '@/resources/types';
import { REL } from '@/resources/configs';
import { Modal, Section, Spinner } from './ui';

const fields: FieldDef[] = [
  { name: 'channel', label: 'Canal', type: 'select', required: true, options: options.channels },
  { name: 'direction', label: 'Sens', type: 'select', required: true, options: [{ value: 'sortant', label: 'Sortant (nous contactons)' }, { value: 'entrant', label: 'Entrant (il/elle nous contacte)' }] },
  { name: 'occurred_at', label: 'Date et heure', type: 'datetime', required: true },
  { name: 'property_id', label: 'Bien concerné', type: 'relation', relation: REL.property },
  { name: 'summary', label: 'Résumé de l’échange', type: 'textarea', required: true, maxLength: 4000 },
  { name: 'next_action', label: 'Prochaine action', type: 'text', full: true },
];

/** Historique des échanges d'un prospect ou d'un propriétaire. */
export function InteractionsPanel({ buyerId, ownerId }: { buyerId?: string; ownerId?: string }) {
  const [open, setOpen] = useState(false);
  const eq = buyerId ? { buyer_id: buyerId } : { owner_id: ownerId };
  const { data, loading, reload } = useQuery(
    () => listRows('interactions', { select: '*, property:properties!interactions_property_id_fkey(reference)', eq, order: { column: 'occurred_at', ascending: false }, pageSize: 100 }),
    [buyerId, ownerId],
  );
  return (
    <Section title="Historique des échanges" actions={<button className="btn-outline btn-sm" onClick={() => setOpen(true)}>+ Échange</button>}>
      {loading ? <Spinner /> : !data?.rows.length ? <p className="text-sm text-ink-500">Aucun échange enregistré.</p> : (
        <ul className="space-y-3">
          {data.rows.map((i) => (
            <li key={i.id} className="border-l-2 border-gold-300 pl-3 text-sm">
              <div className="text-xs text-ink-500">
                {formatDateTime(i.occurred_at)} · {label(CHANNELS, i.channel)} · {i.direction}{i.property ? ` · ${i.property.reference}` : ''}
              </div>
              <p className="whitespace-pre-line">{i.summary}</p>
              {i.next_action && <p className="text-xs text-gold-700">→ {i.next_action}</p>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} title="Nouvel échange" onClose={() => setOpen(false)}>
        <ResourceForm
          table="interactions"
          fields={fields}
          defaults={{ channel: 'appel', direction: 'sortant', occurred_at: new Date().toISOString() }}
          extra={buyerId ? { buyer_id: buyerId } : { owner_id: ownerId }}
          onSaved={() => {
            setOpen(false);
            reload();
          }}
          onCancel={() => setOpen(false)}
        />
      </Modal>
    </Section>
  );
}
