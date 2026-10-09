-- =====================================================================
-- 0005 — Stockage : photos publiques séparées des documents privés.
-- Limites de taille et de formats appliquées au niveau du bucket.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('property-photos', 'property-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('private-documents', 'private-documents', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('finance-receipts', 'finance-receipts', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Photos : lecture publique via l'URL du bucket public ; écriture réservée à l'équipe commerciale.
create policy "photos_staff_select" on storage.objects for select to authenticated
  using (bucket_id = 'property-photos' and public.is_staff());
create policy "photos_sales_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'property-photos' and public.can_sales());
create policy "photos_sales_update" on storage.objects for update to authenticated
  using (bucket_id = 'property-photos' and public.can_sales())
  with check (bucket_id = 'property-photos' and public.can_sales());
create policy "photos_sales_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'property-photos' and public.can_sales());

-- Documents confidentiels : accès authentifié + URL signée temporaire côté client.
create policy "docs_sales_select" on storage.objects for select to authenticated
  using (bucket_id = 'private-documents' and public.can_sales());
create policy "docs_sales_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'private-documents' and public.can_sales());
create policy "docs_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'private-documents' and public.is_admin());

-- Justificatifs financiers.
create policy "receipts_finance_select" on storage.objects for select to authenticated
  using (bucket_id = 'finance-receipts' and public.can_finance());
create policy "receipts_finance_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'finance-receipts' and public.can_finance());
create policy "receipts_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'finance-receipts' and public.is_admin());
