// Thin fetch wrapper: JSON in/out, CSRF header on writes, typed errors.
let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: any,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: payload,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new Event('crm:unauthorized'));
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok)
    throw new ApiError(res.status, data?.error ?? res.statusText, data?.code, data?.details);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Downloads a file from an API GET endpoint (XLSX exports). */
export async function download(path: string, fallbackName: string) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error ?? 'Download failed');
  }
  const blob = await res.blob();
  const name =
    res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
