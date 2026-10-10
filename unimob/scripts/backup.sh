#!/usr/bin/env bash
# Sauvegarde logique de la base Supabase (schéma public + auth) avec pg_dump.
# Usage : SUPABASE_DB_URL='postgresql://postgres:MOT_DE_PASSE@db.xxxx.supabase.co:5432/postgres' ./scripts/backup.sh
# La chaîne de connexion contient un secret : la définir dans le terminal, JAMAIS dans un fichier du dépôt.
set -euo pipefail
: "${SUPABASE_DB_URL:?Définir SUPABASE_DB_URL (voir docs/SAUVEGARDE.md)}"
OUT_DIR="${BACKUP_DIR:-./sauvegardes}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
FILE="$OUT_DIR/base-$STAMP.dump"
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner \
  --schema=public --schema=auth --file="$FILE"
chmod 600 "$FILE"
# Vérification minimale : le fichier est lisible par pg_restore et contient les tables métier.
LISTING="$(pg_restore --list "$FILE")"
grep -q "TABLE DATA public properties" <<<"$LISTING" \
  && echo "Sauvegarde OK : $FILE ($(du -h "$FILE" | cut -f1))" \
  || { echo "ERREUR : sauvegarde incomplète" >&2; exit 1; }
