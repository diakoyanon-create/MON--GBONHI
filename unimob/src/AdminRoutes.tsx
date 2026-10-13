import { Route, Routes } from 'react-router-dom';
import { RequireStaff } from '@/auth/RequireStaff';
import { AdminLayout } from '@/layouts/AdminLayout';
import { ResourceFormPage } from '@/resources/ResourceFormPage';
import { ResourceList } from '@/resources/ResourceList';
import {
  buyersConfig, commissionRulesConfig, expensesConfig, inquiriesConfig, mandatesConfig, ownersConfig, propertiesConfig,
  revenuesConfig, tasksConfig, transactionsConfig, visitsConfig,
} from '@/resources/configs';
import type { ResourceConfig } from '@/resources/types';
import type { Permissions } from '@/auth/AuthContext';
import { DashboardPage } from '@/pages/admin/DashboardPage';
import { PropertyDetailPage } from '@/pages/admin/PropertyDetailPage';
import { PropertyPreviewPage } from '@/pages/admin/PropertyPreviewPage';
import { BuyerDetailPage, InquiryDetailPage, OwnerDetailPage } from '@/pages/admin/ContactPages';
import { FinancesPage, RevenueDetailPage, TransactionDetailPage, VisitsPage } from '@/pages/admin/DealPages';
import { ActivityLogPage, DocumentsPage, ReportsPage, SettingsPage, UsersPage } from '@/pages/admin/AdminPages';
import { NotFoundPage } from '@/pages/public/PublicPages';
import { MandateAside, TransactionAside } from '@/pages/admin/FormAsides';

const rel = (c: ResourceConfig) => c.basePath.replace(/^\/admin\//, '');

function crud(c: ResourceConfig, need: keyof Permissions, opts: { list?: React.ReactNode; detail?: React.ReactNode; aside?: Parameters<typeof ResourceFormPage>[0]['aside'] } = {}) {
  const base = rel(c);
  const guard = (el: React.ReactNode) => <RequireStaff need={need}>{el}</RequireStaff>;
  return [
    <Route key={`${base}-list`} path={base} element={guard(opts.list ?? <ResourceList config={c} />)} />,
    <Route key={`${base}-new`} path={`${base}/nouveau`} element={guard(<ResourceFormPage config={c} aside={opts.aside} />)} />,
    <Route key={`${base}-edit`} path={`${base}/:id/modifier`} element={guard(<ResourceFormPage config={c} aside={opts.aside} />)} />,
    ...(opts.detail ? [<Route key={`${base}-detail`} path={`${base}/:id`} element={guard(opts.detail)} />] : []),
  ];
}

export default function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        {crud(propertiesConfig, 'sales', { detail: <PropertyDetailPage /> })}
        <Route path="biens/:id/apercu" element={<RequireStaff need="sales"><PropertyPreviewPage /></RequireStaff>} />
        {crud(ownersConfig, 'sales', { detail: <OwnerDetailPage /> })}
        {crud(buyersConfig, 'sales', { detail: <BuyerDetailPage /> })}
        {crud(mandatesConfig, 'sales', { aside: MandateAside })}
        {crud(inquiriesConfig, 'sales', { detail: <InquiryDetailPage /> })}
        {crud(visitsConfig, 'sales', { list: <VisitsPage /> })}
        {crud(transactionsConfig, 'staff', { detail: <TransactionDetailPage />, aside: TransactionAside })}
        <Route path="finances" element={<RequireStaff need="finance"><FinancesPage /></RequireStaff>} />
        {crud(revenuesConfig, 'finance', { detail: <RevenueDetailPage /> })}
        {crud(expensesConfig, 'finance')}
        {crud(commissionRulesConfig, 'finance')}
        {crud(tasksConfig, 'staff')}
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="rapports" element={<ReportsPage />} />
        <Route path="parametres" element={<RequireStaff need="admin"><SettingsPage /></RequireStaff>} />
        <Route path="utilisateurs" element={<RequireStaff need="admin"><UsersPage /></RequireStaff>} />
        <Route path="journal" element={<RequireStaff need="admin"><ActivityLogPage /></RequireStaff>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
