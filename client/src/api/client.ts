export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get fieldErrors(): Record<string, string> {
    if (this.code !== 'VALIDATION_ERROR' || !Array.isArray(this.details)) return {};
    return Object.fromEntries(
      (this.details as { field: string; message: string }[]).map((d) => [d.field, d.message]),
    );
  }
}

const ACTOR_KEY = 'relay.dispatcher';
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export const getDispatcherName = (): string => {
  try {
    return localStorage.getItem(ACTOR_KEY) ?? 'Asha Menon';
  } catch {
    return 'Asha Menon';
  }
};
export const setDispatcherName = (name: string): void => {
  try {
    localStorage.setItem(ACTOR_KEY, name);
  } catch {
    return;
  }
};

export interface RiderIdentity {
  id: string;
  name: string;
}
export interface RequestOptions {
  body?: unknown;
  asRider?: RiderIdentity;
}

async function request<T>(
  method: string,
  path: string,
  { body, asRider }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (asRider) {
    Object.assign(headers, {
      'X-Actor-Role': 'RIDER',
      'X-Actor-Id': asRider.id,
      'X-Actor-Name': asRider.name,
    });
  } else {
    Object.assign(headers, { 'X-Actor-Role': 'DISPATCHER', 'X-Actor-Name': getDispatcherName() });
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Cannot reach the RELAY API. Check that the server is running.',
    );
  }

  const payload = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; details?: unknown };
  } | null;
  if (!res.ok) {
    const e = payload?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'HTTP_ERROR',
      e?.message ?? `Request failed (${res.status})`,
      e?.details,
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, opts?: RequestOptions) => request<T>('POST', path, opts),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
};

export const qs = (
  params: Record<string, string | number | boolean | undefined | null>,
): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};
