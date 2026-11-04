import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSystemConfig } from '../api/hooks';

interface ServerClock {
  now: Date;
  offsetMs: number;
}

const ClockCtx = createContext<ServerClock>({ now: new Date(), offsetMs: 0 });

export function ServerClockProvider({ children }: { children: ReactNode }) {
  const { data } = useSystemConfig();
  const serverNow = data?.now;
  const [clock, setClock] = useState<ServerClock>({ now: new Date(), offsetMs: 0 });

  useEffect(() => {
    const offsetMs = serverNow ? new Date(serverNow).getTime() - Date.now() : 0;
    const id = setInterval(
      () => setClock({ now: new Date(Date.now() + offsetMs), offsetMs }),
      1000,
    );
    return () => clearInterval(id);
  }, [serverNow]);

  return <ClockCtx.Provider value={clock}>{children}</ClockCtx.Provider>;
}

export const useServerNow = (): Date => useContext(ClockCtx).now;
