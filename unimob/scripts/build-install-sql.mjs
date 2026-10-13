// Concatène les migrations en un seul fichier à coller dans l'éditeur SQL de Supabase.
// Usage : node scripts/build-install-sql.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const parts = files.map((f) => `-- ===== ${f} =====\n${readFileSync(join(dir, f), 'utf8')}`);
const header = `-- INSTALLATION COMPLÈTE (générée par scripts/build-install-sql.mjs — ne pas modifier à la main)
-- À exécuter UNE SEULE FOIS sur un projet Supabase vierge : SQL Editor → New query → coller → Run.
-- Contient les ${files.length} migrations dans l'ordre. Ne contient AUCUNE donnée de démonstration.\n\n`;
writeFileSync(join(root, 'supabase/installation_complete.sql'), header + parts.join('\n\n'));
console.log(`supabase/installation_complete.sql (${files.length} migrations)`);
