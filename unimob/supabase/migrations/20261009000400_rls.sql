-- =====================================================================
-- 0004 — Row Level Security et privilèges
-- Principe : moindre privilège. Le rôle anon n'a AUCUN accès direct
-- aux tables métier ; le site public passe par des vues restreintes
-- et la fonction submit_inquiry().
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'owners', 'properties', 'property_photos', 'property_documents', 'document_checks',
    'buyers', 'commission_rules', 'mandates', 'inquiries', 'interactions', 'visits',
    'transactions', 'negotiations', 'financial_entries', 'payments', 'expenses',
    'tasks', 'documents'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
  end loop;
end $$;

create policy owners_read on public.owners for select to authenticated using (public.can_sales());
create policy owners_insert on public.owners for insert to authenticated with check (public.can_sales());
create policy owners_update on public.owners for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy owners_delete on public.owners for delete to authenticated using (public.is_admin());

create policy properties_read on public.properties for select to authenticated using (public.is_staff());
create policy properties_insert on public.properties for insert to authenticated with check (public.can_sales());
create policy properties_update on public.properties for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy properties_delete on public.properties for delete to authenticated using (public.is_admin());

create policy property_photos_read on public.property_photos for select to authenticated using (public.is_staff());
create policy property_photos_write on public.property_photos for insert to authenticated with check (public.can_sales());
create policy property_photos_update on public.property_photos for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy property_photos_delete on public.property_photos for delete to authenticated using (public.can_sales());

create policy property_documents_read on public.property_documents for select to authenticated using (public.can_sales());
create policy property_documents_insert on public.property_documents for insert to authenticated with check (public.can_sales());
create policy property_documents_delete on public.property_documents for delete to authenticated using (public.is_admin());

create policy document_checks_read on public.document_checks for select to authenticated using (public.can_sales());
create policy document_checks_insert on public.document_checks for insert to authenticated with check (public.can_sales());
create policy document_checks_update on public.document_checks for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy document_checks_delete on public.document_checks for delete to authenticated using (public.is_admin());

create policy buyers_read on public.buyers for select to authenticated using (public.can_sales());
create policy buyers_insert on public.buyers for insert to authenticated with check (public.can_sales());
create policy buyers_update on public.buyers for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy buyers_delete on public.buyers for delete to authenticated using (public.is_admin());

create policy commission_rules_read on public.commission_rules for select to authenticated using (public.is_staff());
create policy commission_rules_insert on public.commission_rules for insert to authenticated with check (public.can_finance());
create policy commission_rules_update on public.commission_rules for update to authenticated using (public.can_finance()) with check (public.can_finance());
create policy commission_rules_delete on public.commission_rules for delete to authenticated using (public.is_admin());

create policy mandates_read on public.mandates for select to authenticated using (public.can_sales() or public.can_finance());
create policy mandates_insert on public.mandates for insert to authenticated with check (public.can_sales());
create policy mandates_update on public.mandates for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy mandates_delete on public.mandates for delete to authenticated using (public.is_admin());

create policy inquiries_read on public.inquiries for select to authenticated using (public.can_sales());
create policy inquiries_insert on public.inquiries for insert to authenticated with check (public.can_sales());
create policy inquiries_update on public.inquiries for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy inquiries_delete on public.inquiries for delete to authenticated using (public.is_admin());

create policy interactions_read on public.interactions for select to authenticated using (public.can_sales());
create policy interactions_insert on public.interactions for insert to authenticated with check (public.can_sales());
create policy interactions_update on public.interactions for update to authenticated
  using (public.is_admin() or (public.can_sales() and created_by = auth.uid()))
  with check (public.can_sales());
create policy interactions_delete on public.interactions for delete to authenticated using (public.is_admin());

create policy visits_read on public.visits for select to authenticated using (public.can_sales());
create policy visits_insert on public.visits for insert to authenticated with check (public.can_sales());
create policy visits_update on public.visits for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy visits_delete on public.visits for delete to authenticated using (public.is_admin());

create policy transactions_read on public.transactions for select to authenticated using (public.can_sales() or public.can_finance());
create policy transactions_insert on public.transactions for insert to authenticated with check (public.can_negotiate());
create policy transactions_update on public.transactions for update to authenticated using (public.can_negotiate()) with check (public.can_negotiate());
create policy transactions_delete on public.transactions for delete to authenticated using (public.is_admin());

create policy negotiations_read on public.negotiations for select to authenticated using (public.can_sales());
create policy negotiations_insert on public.negotiations for insert to authenticated with check (public.can_negotiate());
create policy negotiations_update on public.negotiations for update to authenticated using (public.can_negotiate()) with check (public.can_negotiate());
create policy negotiations_delete on public.negotiations for delete to authenticated using (public.is_admin());

-- Finances : jamais de suppression via l'API (annulation par statut, corrections tracées).
create policy financial_entries_read on public.financial_entries for select to authenticated using (public.can_finance());
create policy financial_entries_insert on public.financial_entries for insert to authenticated with check (public.can_finance());
create policy financial_entries_update on public.financial_entries for update to authenticated using (public.can_finance()) with check (public.can_finance());
revoke delete on public.financial_entries from authenticated;

create policy payments_read on public.payments for select to authenticated using (public.can_finance());
create policy payments_insert on public.payments for insert to authenticated with check (public.can_finance());
revoke update, delete on public.payments from authenticated;

create policy expenses_read on public.expenses for select to authenticated using (public.can_finance());
create policy expenses_insert on public.expenses for insert to authenticated with check (public.can_finance());
create policy expenses_update on public.expenses for update to authenticated using (public.can_finance()) with check (public.can_finance());
create policy expenses_delete on public.expenses for delete to authenticated using (public.is_admin());

create policy tasks_read on public.tasks for select to authenticated using (public.is_staff());
create policy tasks_insert on public.tasks for insert to authenticated with check (public.is_staff());
create policy tasks_update on public.tasks for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()));

create policy documents_read on public.documents for select to authenticated using (public.is_staff());
create policy documents_insert on public.documents for insert to authenticated with check (public.is_staff());
create policy documents_delete on public.documents for delete to authenticated using (public.is_admin());
revoke update on public.documents from authenticated;
