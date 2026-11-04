import { ArrowRight } from 'lucide-react';
import type { AttentionItem } from '../api/types';
import { cx } from './ui/cls';

export const Route = ({ from, to }: { from: string; to: string }) => (
  <span className="inline-flex items-center gap-2">
    {from}
    <ArrowRight size={13} className="text-slate-400" />
    {to}
  </span>
);

export function AttentionBadges({ items, max = 2 }: { items: AttentionItem[]; max?: number }) {
  if (!items.length) return <span className="text-slate-300">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.slice(0, max).map((a) => (
        <span
          key={a.code}
          title={a.message}
          className={cx(
            'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
            a.severity === 'critical'
              ? 'bg-rose-50 text-rose-700 ring-rose-200'
              : 'bg-amber-50 text-amber-700 ring-amber-200',
          )}
        >
          <span
            className={cx(
              'size-1.5 rounded-full',
              a.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-500',
            )}
          />
          {a.code
            .split('_')
            .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
            .join(' ')}
        </span>
      ))}
    </div>
  );
}
