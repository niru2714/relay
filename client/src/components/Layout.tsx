import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRightLeft, Bike, Briefcase, LayoutDashboard, Pencil, Siren } from 'lucide-react';
import { useDashboard } from '../api/hooks';
import { getDispatcherName, setDispatcherName } from '../api/client';
import { cx, input } from './ui/cls';

const NAV = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: LayoutDashboard, end: true },
  { to: '/jobs', label: 'Jobs', short: 'Jobs', icon: Briefcase },
  { to: '/queue', label: 'Manual queue', short: 'Queue', icon: Siren, badge: true },
  { to: '/riders', label: 'Riders', short: 'Riders', icon: Bike },
];

export function Layout() {
  const { data } = useDashboard();
  const location = useLocation();
  const queueCount = data?.totals.manualQueue ?? 0;
  const [name, setName] = useState(getDispatcherName());
  const [editing, setEditing] = useState(false);

  return (
    <div className="grid min-h-full grid-cols-1 content-start md:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-2 py-2 backdrop-blur md:h-screen md:flex-col md:items-stretch md:gap-1.5 md:border-b-0 md:border-r md:p-4">
        <div className="flex flex-none items-center gap-3 px-1 md:px-2 md:pb-6 md:pt-1">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br md:size-10 from-indigo-500 to-cyan-400 shadow-lg shadow-indigo-500/30">
            <ArrowRightLeft size={20} color="white" />
          </div>
          <div className="hidden md:block">
            <b className="text-[17px] tracking-[0.08em] text-slate-900">RELAY</b>
            <small className="-mt-0.5 block text-[11px] text-slate-500">Dispatch desk</small>
          </div>
        </div>
        <nav
          aria-label="Main"
          className="grid min-w-0 flex-1 grid-cols-4 gap-1 md:flex md:flex-none md:flex-col"
        >
          {NAV.map(({ to, label, short, icon: Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'relative flex flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-xl px-1 py-1.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo-300 md:flex-row md:justify-start md:gap-3 md:px-3 md:py-2.5 md:text-sm',
                  isActive ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-900',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-xl border border-indigo-100 bg-indigo-50"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <Icon size={18} className="relative" />
                  <span className="relative md:hidden">{short}</span>
                  <span className="relative hidden md:inline">{label}</span>
                  {badge && queueCount > 0 && (
                    <motion.span
                      key={queueCount}
                      className="absolute right-1.5 top-0 rounded-full bg-rose-500 px-1.5 text-[10px] font-bold leading-4 text-white md:static md:ml-auto md:text-[11px]"
                      initial={{ scale: 1.6 }}
                      animate={{ scale: 1 }}
                    >
                      {queueCount}
                    </motion.span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs md:block">
          <div className="flex items-center gap-2 text-slate-500">
            <i className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> Live · refreshing
            every 4s
          </div>
          <div className="mt-2.5 text-[11px] text-slate-500">Acting as dispatcher</div>
          {editing ? (
            <input
              className={cx(input, 'mt-1 !px-2 !py-1')}
              value={name}
              autoFocus
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const n = name.trim() || 'Asha Menon';
                setName(n);
                setDispatcherName(n);
                setEditing(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <button
              className="mt-0.5 flex items-center gap-1.5 font-semibold text-slate-900"
              onClick={() => setEditing(true)}
              title="Change the name recorded in the audit trail"
            >
              {name} <Pencil size={12} className="text-slate-400" />
            </button>
          )}
        </div>
      </aside>
      <main className="mx-auto w-full min-w-0 max-w-[1500px] px-4 pb-16 pt-6 md:px-8">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
        >
          <Outlet />
        </motion.div> 
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
  icon,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3.5">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
          {icon}
          {title}
        </h1>
        {subtitle && <div className="mt-0.5 text-slate-500">{subtitle}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
