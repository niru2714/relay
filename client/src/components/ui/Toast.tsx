import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
  code?: string;
}
interface ToastApi {
  success: (m: string) => void;
  error: (m: string, code?: string) => void;
  info: (m: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);
let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback(
    (id: number) => setItems((list) => list.filter((t) => t.id !== id)),
    [],
  );
  const push = useCallback(
    (kind: Kind, message: string, code?: string) => {
      const id = (counter += 1);
      setItems((list) => [...list.slice(-3), { id, kind, message, code }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m, c) => push('error', m, c),
      info: (m) => push('info', m),
    }),
    [push],
  );
  const Icon = { success: CheckCircle2, error: AlertTriangle, info: Info };

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        className="fixed bottom-5 right-5 z-[100] flex w-[min(380px,calc(100vw-40px))] flex-col gap-2.5"
        role="status"
        aria-live="polite"
      >
        <AnimatePresence>
          {items.map((t) => {
            const I = Icon[t.kind];
            return (
              <motion.div
                key={t.id}
                layout
                className={`flex items-start gap-3 rounded-2xl border bg-white p-3.5 shadow-lg ${t.kind === 'error' ? 'border-rose-200' : 'border-slate-200'}`}
                initial={{ opacity: 0, x: 60, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 60, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <I
                  size={18}
                  className={
                    t.kind === 'success'
                      ? 'text-emerald-500'
                      : t.kind === 'error'
                        ? 'text-rose-500'
                        : 'text-sky-500'
                  }
                />
                <div className="flex-1 text-slate-800">
                  <div>{t.message}</div>
                  {t.code && <div className="font-mono text-[11px] text-slate-400">{t.code}</div>}
                </div>
                <button
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
