import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Activity,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  CalendarCheck,
  CheckSquare,
  IndianRupee,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  Settings,
  UserRound,
  Users,
} from 'lucide-react';
import { isAdmin, isManager } from '@crm/shared';
import { api } from '../lib/api';
import { useAuth, useMe } from '../lib/auth';
import { useCounts } from '../lib/queries';
import { ago } from '../lib/format';
import type { Notification } from '../lib/types';
import { Avatar } from './ui';
import { ApplicationDrawer } from '../features/ApplicationDrawer';
import { ErrorBoundary } from './ErrorBoundary';

const ic = 'size-[16px] shrink-0';
const S = 1.8;

export function Layout() {
  const me = useMe();
  const { data: counts } = useCounts();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => mainRef.current?.scrollTo(0, 0), [location.pathname]);

  return (
    <div className="flex h-full">
      <aside className="hidden w-sidebar shrink-0 flex-col border-r hairline bg-sidebar px-14 py-16 lg:flex">
        <Link to="/" className="flex items-center gap-8 px-6">
          <span className="grid size-26 place-items-center rounded-md bg-forest text-mint">
            <Briefcase className="size-14" strokeWidth={S} />
          </span>
          <span className="text-14 font-semibold tracking-[-0.01em]">Recruitment CRM</span>
        </Link>
        <nav className="mt-20 flex-1 space-y-16 overflow-y-auto text-12">
          <NavGroup label="Main">
            <Item to="/" icon={<LayoutDashboard className={ic} strokeWidth={S} />} end>
              Dashboard
            </Item>
            <Item to="/tasks" icon={<CheckSquare className={ic} strokeWidth={S} />} count={counts?.dueToday}>
              My tasks
            </Item>
            <Item to="/calendar" icon={<CalendarCheck className={ic} strokeWidth={S} />}>
              Calendar
            </Item>
          </NavGroup>
          <NavGroup label="Recruitment">
            <Item to="/clients" icon={<Building2 className={ic} strokeWidth={S} />}>
              Clients
            </Item>
            <Item to="/requirements" icon={<Briefcase className={ic} strokeWidth={S} />}>
              Requirements
            </Item>
            <Item to="/candidates" icon={<Users className={ic} strokeWidth={S} />}>
              Candidates
            </Item>
            <Item to="/pipeline" icon={<KanbanSquare className={ic} strokeWidth={S} />}>
              Pipeline
            </Item>
          </NavGroup>
          <NavGroup label="Management">
            <Item to="/reports" icon={<BarChart3 className={ic} strokeWidth={S} />}>
              Reports
            </Item>
            {isManager(me.role) && (
              <>
                <Item to="/placements" icon={<IndianRupee className={ic} strokeWidth={S} />}>
                  Placements
                </Item>
                <Item to="/activity" icon={<Activity className={ic} strokeWidth={S} />}>
                  Activity &amp; audit
                </Item>
              </>
            )}
          </NavGroup>
        </nav>
        <div className="space-y-2 pt-12 text-12 text-ink-2">
          {isAdmin(me.role) && (
            <Item to="/settings" icon={<Settings className={ic} strokeWidth={S} />}>
              Settings
            </Item>
          )}
          <UserMenu />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <TopBar />
        <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto">
          <div key={location.pathname} className="mx-auto max-w-[1600px] p-16 animate-pop lg:p-24">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <ApplicationDrawer />
    </div>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-4 px-12 text-9 font-medium uppercase tracking-[0.08em] text-ink-3">{label}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Item({ to, icon, children, count, end }: { to: string; icon: ReactNode; children: ReactNode; count?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-10 rounded-full px-12 py-7 transition',
          isActive ? 'bg-forest font-medium text-mint' : 'text-ink-2 hover:bg-paper-2 hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          {icon}
          <span className="truncate">{children}</span>
          {!!count && (
            <span className={clsx('tnum ml-auto rounded-full px-6 text-9', isActive ? 'bg-white/20 text-mint' : 'bg-brass-soft text-brass-text')}>{count}</span>
          )}
        </>
      )}
    </NavLink>
  );
}

function UserMenu() {
  const me = useMe();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="relative border-t hairline pt-12">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-8 rounded-md px-6 py-4 text-left hover:bg-paper-2">
        <Avatar name={me.name} />
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-11 font-medium text-ink">{me.name}</span>
          <span className="block text-9 capitalize text-ink-3">{me.role}</span>
        </span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-6 w-full rounded-lg bg-surface p-4 shadow-pop" onMouseLeave={() => setOpen(false)}>
          <button className="flex w-full items-center gap-8 rounded-md px-10 py-7 text-11 hover:bg-paper" onClick={() => { setOpen(false); navigate('/profile'); }}>
            <UserRound className="size-14" strokeWidth={S} /> My profile &amp; referral link
          </button>
          <button className="flex w-full items-center gap-8 rounded-md px-10 py-7 text-11 text-signal-red hover:bg-coral-soft" onClick={() => void logout()}>
            <LogOut className="size-14" strokeWidth={S} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const navigate = useNavigate();
  const [newOpen, setNewOpen] = useState(false);
  return (
    <div className="flex items-center gap-10 border-b hairline px-18 py-11">
      <MobileNav />
      <GlobalSearch />
      <div className="relative ml-auto">
        <button onClick={() => setNewOpen((o) => !o)} className="flex items-center gap-6 rounded-full bg-forest px-14 py-7 text-11 font-medium text-mint hover:bg-forest-2">
          <Plus className="size-14" strokeWidth={S} /> New
        </button>
        {newOpen && (
          <div className="absolute right-0 top-full z-30 mt-6 w-[200px] rounded-lg bg-surface p-4 shadow-pop" onMouseLeave={() => setNewOpen(false)}>
            {[
              ['Candidate', '/candidates?new=1'],
              ['Requirement', '/requirements?new=1'],
              ['Client', '/clients?new=1'],
              ['Task', '/tasks?new=1'],
              ['Import candidates', '/import'],
            ].map(([label, to]) => (
              <button key={to} className="block w-full rounded-md px-10 py-7 text-left text-11 hover:bg-paper" onClick={() => { setNewOpen(false); navigate(to); }}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <Notifications />
    </div>
  );
}

function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const links: [string, string][] = [
    ['/', 'Dashboard'],
    ['/tasks', 'My tasks'],
    ['/calendar', 'Calendar'],
    ['/clients', 'Clients'],
    ['/requirements', 'Requirements'],
    ['/candidates', 'Candidates'],
    ['/pipeline', 'Pipeline'],
    ['/reports', 'Reports'],
    ...(isManager(me.role) ? ([['/placements', 'Placements'], ['/activity', 'Activity']] as [string, string][]) : []),
    ...(isAdmin(me.role) ? ([['/settings', 'Settings']] as [string, string][]) : []),
    ['/profile', 'Profile'],
  ];
  return (
    <select className="input w-[140px] lg:hidden" value={location.pathname} onChange={(e) => navigate(e.target.value)} aria-label="Navigate">
      {links.map(([to, label]) => (
        <option key={to} value={to}>{label}</option>
      ))}
    </select>
  );
}

interface SearchResult {
  candidates: { id: number; name: string; currentCompany: string | null; phone: string | null }[];
  requirements: { id: number; code: string; title: string; clientName: string }[];
  clients: { id: number; name: string; city: string | null }[];
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResult>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  });
  const go = (to: string) => {
    setOpen(false);
    setQ('');
    navigate(to);
  };
  const total = data ? data.candidates.length + data.requirements.length + data.clients.length : 0;
  return (
    <div className="relative min-w-0 flex-1 lg:max-w-[400px]">
      <label className="flex items-center gap-8 rounded-full bg-paper px-12 py-7 text-11 text-ink-3 focus-within:ring-2 focus-within:ring-forest-2">
        <Search className="size-14 shrink-0" strokeWidth={S} />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search candidates, phone numbers, requirements, clients"
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
        />
      </label>
      {open && debounced.length >= 2 && data && (
        <div className="absolute left-0 right-0 top-full z-30 mt-6 max-h-[60vh] overflow-y-auto rounded-lg bg-surface p-6 shadow-pop">
          {total === 0 && <p className="px-10 py-8 text-10 text-ink-3">No matches for “{debounced}”.</p>}
          {data.candidates.length > 0 && <p className="px-10 pt-4 text-9 uppercase tracking-[0.06em] text-ink-3">Candidates</p>}
          {data.candidates.map((c) => (
            <button key={`c${c.id}`} onMouseDown={() => go(`/candidates/${c.id}`)} className="flex w-full items-center gap-8 rounded-md px-10 py-6 text-left hover:bg-paper">
              <Avatar name={c.name} size={22} />
              <span className="min-w-0 flex-1 truncate text-11">{c.name}</span>
              <span className="truncate text-9 text-ink-3">{c.currentCompany ?? c.phone}</span>
            </button>
          ))}
          {data.requirements.length > 0 && <p className="px-10 pt-6 text-9 uppercase tracking-[0.06em] text-ink-3">Requirements</p>}
          {data.requirements.map((r) => (
            <button key={`r${r.id}`} onMouseDown={() => go(`/requirements/${r.id}`)} className="flex w-full items-center gap-8 rounded-md px-10 py-6 text-left hover:bg-paper">
              <span className="text-9 text-ink-3">{r.code}</span>
              <span className="min-w-0 flex-1 truncate text-11">{r.title}</span>
              <span className="truncate text-9 text-ink-3">{r.clientName}</span>
            </button>
          ))}
          {data.clients.length > 0 && <p className="px-10 pt-6 text-9 uppercase tracking-[0.06em] text-ink-3">Clients</p>}
          {data.clients.map((c) => (
            <button key={`k${c.id}`} onMouseDown={() => go(`/clients/${c.id}`)} className="flex w-full items-center gap-8 rounded-md px-10 py-6 text-left hover:bg-paper">
              <Building2 className="size-14 text-ink-3" strokeWidth={S} />
              <span className="min-w-0 flex-1 truncate text-11">{c.name}</span>
              <span className="text-9 text-ink-3">{c.city}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const { data: counts } = useCounts();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/notifications'), enabled: open });
  const markAll = async () => {
    await api.post('/notifications/read');
    void qc.invalidateQueries({ queryKey: ['counts'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const openOne = async (n: Notification) => {
    if (!n.readAt) await api.post('/notifications/read', { id: n.id });
    void qc.invalidateQueries({ queryKey: ['counts'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    setOpen(false);
    if (n.link) navigate(n.link);
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-full p-6 text-ink-2 hover:bg-paper-2" aria-label="Notifications">
        <Bell className="size-[18px]" strokeWidth={S} />
        {!!counts?.unreadNotifications && <span className="absolute right-[5px] top-[5px] size-7 rounded-full bg-brass" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-6 w-[360px] rounded-lg bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b hairline px-14 py-10">
            <p className="text-12 font-medium">Notifications</p>
            <button className="text-10 text-forest-2 hover:underline" onClick={() => void markAll()}>Mark all read</button>
          </div>
          <div className="max-h-[420px] overflow-y-auto p-4">
            {!data?.length && <p className="px-10 py-16 text-center text-10 text-ink-3">You're all caught up.</p>}
            {data?.map((n) => (
              <button key={n.id} onClick={() => void openOne(n)} className="flex w-full gap-8 rounded-md px-10 py-8 text-left hover:bg-paper">
                <span className={clsx('mt-[6px] size-6 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brass')} />
                <span className="min-w-0">
                  <span className="block text-11 font-medium">{n.title}</span>
                  {n.body && <span className="block text-10 text-ink-2">{n.body}</span>}
                  <span className="block text-9 text-ink-3">{ago(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
