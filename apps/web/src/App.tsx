import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { isAdmin, isManager } from '@crm/shared';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { TasksPage } from './pages/TasksPage';
import { CalendarPage } from './pages/CalendarPage';
import { ClientsPage, ClientDetailPage } from './pages/ClientsPage';
import { RequirementsPage } from './pages/RequirementsPage';
import { RequirementDetailPage } from './pages/RequirementDetailPage';
import { CandidatesPage } from './pages/CandidatesPage';
import { CandidateDetailPage } from './pages/CandidateDetailPage';
import { PipelinePage } from './pages/PipelinePage';
import { ReportsPage } from './pages/ReportsPage';
import { PlacementsPage } from './pages/PlacementsPage';
import { ActivityPage } from './pages/ActivityPage';
import { SettingsPage } from './pages/SettingsPage';
import { ImportPage } from './pages/ImportPage';
import { ProfilePage } from './pages/ProfilePage';
import { ReferralPage } from './pages/ReferralPage';

export function App() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (location.pathname.startsWith('/refer/')) {
    return (
      <Routes>
        <Route path="/refer/:code" element={<ReferralPage />} />
      </Routes>
    );
  }
  if (loading) return <Loading />;
  if (!user) return <LoginPage />;
  const manager = isManager(user.role);
  const guard = (ok: boolean, el: ReactNode) => (ok ? el : <Navigate to="/" replace />);
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:id" element={<ClientDetailPage />} />
        <Route path="requirements" element={<RequirementsPage />} />
        <Route path="requirements/:id" element={<RequirementDetailPage />} />
        <Route path="candidates" element={<CandidatesPage />} />
        <Route path="candidates/:id" element={<CandidateDetailPage />} />
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="placements" element={guard(manager, <PlacementsPage />)} />
        <Route path="activity" element={guard(manager, <ActivityPage />)} />
        <Route path="settings" element={guard(isAdmin(user.role), <SettingsPage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
