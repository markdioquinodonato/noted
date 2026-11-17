import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Menu,
  Moon,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Sun,
} from 'lucide-react';
import { toast } from 'sonner';
import { BrandMark } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { AccountMenu } from '@/features/auth/AccountMenu';
import { useAuth } from '@/features/auth/AuthProvider';
import { readBrowserValue, writeBrowserValue } from '@/lib/browserStorage';
import { setThemePreference, useThemeState } from '@/lib/theme';
import { useAlerts } from './adminData';
import { stamp } from './adminFormat';
import { adminGroups, adminItems, adminUrl, notificationsItem } from './navigation';
import './admin.css';

export type AdminContext = { days: number };
const ranged = new Set([
  '',
  'user-analytics',
  'platform-analytics',
  'storage',
  'transcription',
  'ai-usage',
  'health',
  'security',
]);

function Navigation({ central, close }: { central: boolean; close?: () => void }) {
  const groups = central
    ? adminGroups
    : adminGroups.slice(2, 3).map((group) => ({
        ...group,
        items: group.items.filter((item) => item.path === 'transcription'),
      }));
  return (
    <nav aria-label="Administration" className="admin-nav">
      {groups.map((group) => (
        <div className="admin-group" key={group.label}>
          <span className="admin-nav-caption">{group.label}</span>
          {group.items.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              end
              to={adminUrl(path)}
              onClick={close}
              title={label}
              aria-label={label}
              className="admin-nav-link"
            >
              <Icon aria-hidden="true" />
              <span className="admin-nav-text">{label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function AdminLayout({ central }: { central: boolean }) {
  const { user } = useAuth();
  const theme = useThemeState();
  const client = useQueryClient();
  const [collapsed, setCollapsed] = useState(
    () => readBrowserValue('noted:admin-sidebar') === 'collapsed',
  );
  const [mobile, setMobile] = useState(false);
  const [days, setDays] = useState(30);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState<string>();
  const main = useRef<HTMLElement>(null);
  const location = useLocation();
  const path = location.pathname.replace(/\/+$/, '').toLowerCase();
  const item = [...adminItems, notificationsItem].find((i) => adminUrl(i.path) === path);
  const title = item?.label ?? 'Administration';
  const alerts = useAlerts(central);
  const unread = alerts.data?.items.filter((x) => !x.read_at && !x.dismissed_at).length ?? 0;
  const Brand = (
    <>
      <BrandMark size={31} />
      <span className="admin-brand-text text-lg font-bold tracking-tight">Noted</span>
    </>
  );
  async function refresh() {
    setRefreshing(true);
    try {
      await client.refetchQueries(
        { queryKey: ['admin', user?.id], type: 'active' },
        { throwOnError: true },
      );
      setRefreshed(new Date().toISOString());
      toast.success('Dashboard data refreshed');
    } catch {
      toast.error('Some data could not be refreshed');
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <div className="admin-app">
      <a
        href="#admin-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-card focus:p-3"
        onClick={() => main.current?.focus()}
      >
        Skip to content
      </a>
      <div className="admin-shell" data-collapsed={collapsed}>
        <aside className="admin-sidebar">
          <div
            className="flex h-[62px] shrink-0 items-center justify-between gap-2 border-b px-4 data-[collapsed=true]:justify-center"
            data-collapsed={collapsed}
          >
            <Link
              to={adminUrl(central ? '' : 'transcription')}
              className="flex items-center gap-2.5"
              aria-label="Noted administration"
            >
              {Brand}
            </Link>
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Collapse sidebar"
                onClick={() => {
                  writeBrowserValue('noted:admin-sidebar', 'collapsed');
                  setCollapsed(true);
                }}
              >
                <PanelLeftClose />
              </Button>
            )}
          </div>
          {collapsed && (
            <Button
              className="mx-auto mt-2"
              variant="ghost"
              size="icon"
              aria-label="Expand sidebar"
              onClick={() => {
                writeBrowserValue('noted:admin-sidebar', 'expanded');
                setCollapsed(false);
              }}
            >
              <PanelLeftOpen />
            </Button>
          )}
          <Navigation central={central} />
          <div className="mt-auto border-t p-3">
            <Link
              className="admin-nav-link"
              to="/notes"
              title="Back to Notes"
              aria-label="Back to Notes"
            >
              <NotebookPen />
              <span className="admin-nav-text">Back to Notes</span>
            </Link>
          </div>
        </aside>
        <div className="min-w-0">
          <header className="admin-toolbar">
            <div className="flex min-w-0 items-center gap-2">
              <Sheet open={mobile} onOpenChange={setMobile}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="admin-mobile-only admin-target"
                    aria-label="Open admin navigation"
                  >
                    <Menu />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="max-w-[310px] gap-0 overflow-y-auto">
                  <SheetTitle className="flex items-center gap-2 border-b p-4">
                    <BrandMark size={28} /> Noted
                  </SheetTitle>
                  <SheetDescription className="sr-only">Administration menu</SheetDescription>
                  <Navigation central={central} close={() => setMobile(false)} />
                  <Link className="admin-nav-link m-3" to="/notes">
                    <NotebookPen /> Back to Notes
                  </Link>
                </SheetContent>
              </Sheet>
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-xs">
                {central && (
                  <>
                    <Link
                      className="text-muted-foreground hover:text-foreground max-sm:hidden"
                      to="/admin"
                    >
                      Admin
                    </Link>
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground max-sm:hidden" />
                  </>
                )}
                <span className="truncate font-semibold" aria-current="page">
                  {title}
                </span>
              </nav>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {item && ranged.has(item.path) && (
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  <CalendarDays className="size-4 max-sm:hidden" aria-hidden="true" />
                  <span className="sr-only">Date range</span>
                  <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    <option value={7}>Last 7 days</option>
                    <option value={14}>Last 14 days</option>
                    <option value={30}>Last 30 days</option>
                    <option value={45}>Last 45 days</option>
                  </select>
                </label>
              )}
              <Button
                className="admin-target"
                size="icon"
                variant="ghost"
                title="Refresh current data"
                aria-label="Refresh current data"
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                <RefreshCw className={refreshing ? 'motion-safe:animate-spin' : undefined} />
              </Button>
              <Button
                className="admin-target"
                size="icon"
                variant="ghost"
                title={theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
                aria-label={
                  theme.resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
                }
                onClick={() => setThemePreference(theme.resolved === 'dark' ? 'light' : 'dark')}
              >
                {theme.resolved === 'dark' ? <Sun /> : <Moon />}
              </Button>
              {central && (
                <Button className="admin-target relative" asChild size="icon" variant="ghost">
                  <Link
                    to="/admin/notifications"
                    aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
                    title="Notifications"
                  >
                    <Bell />
                    {unread > 0 && (
                      <span className="absolute top-1.5 right-1.5 size-2 rounded-full border border-card bg-primary" />
                    )}
                  </Link>
                </Button>
              )}
              <AccountMenu inAdministration />
            </div>
          </header>
          <main id="admin-content" tabIndex={-1} ref={main} className="admin-content">
            {refreshed && (
              <p role="status" className="mb-3 text-xs text-muted-foreground">
                Last refreshed {stamp(refreshed)}
              </p>
            )}
            <Outlet context={{ days } satisfies AdminContext} />
          </main>
        </div>
      </div>
    </div>
  );
}
