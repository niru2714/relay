export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');

export const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';
export const cardTitle = 'mb-3.5 flex items-center gap-2 text-sm font-semibold text-slate-900';
export const input =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100 aria-[invalid=true]:border-rose-400 aria-[invalid=true]:ring-rose-100';
export const label = 'text-xs font-semibold text-slate-600';
export const fieldError = 'text-xs text-rose-600';
export const tag =
  'inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600';
export const muted = 'text-slate-500';

export const banner = {
  critical:
    'flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800',
  warning:
    'flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800',
  info: 'flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-[13px] text-sky-800',
} as const;
