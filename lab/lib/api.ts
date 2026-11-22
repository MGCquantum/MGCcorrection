"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Same-origin proxies to the two local backends (see next.config.ts). */
export const AEGIS = "/api/aegis";
export const SIM = "/api/sim";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function parse(res: Response) {
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = (body && typeof body === "object" && "error" in body) ? String((body as { error: unknown }).error)
      : res.status >= 500 && !body ? "The backend is not reachable. Is it running?" : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return body;
}

export async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  return (await parse(await fetch(url, { cache: "no-store", signal }))) as T;
}

export async function postJSON<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return (await parse(await fetch(url, {
    method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }))) as T;
}

export type Async<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

/** GET on mount (and when url changes). */
export function useGet<T>(url: string | null): Async<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!url });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    getJSON<T>(url, ctrl.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((e: Error) => { if (e.name !== "AbortError") setState({ data: null, error: e.message, loading: false }); });
    return () => ctrl.abort();
  }, [url, tick]);
  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** A POST triggered by the user. Keeps the last good result while a new one runs. */
export function useRun<Req, Res>(url: string) {
  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const run = useCallback(async (body: Req) => {
    ctrl.current?.abort();
    const c = new AbortController(); ctrl.current = c;
    setLoading(true); setError(null);
    try { const res = await postJSON<Res>(url, body, c.signal); setData(res); return res; }
    catch (e) { if ((e as Error).name !== "AbortError") setError((e as Error).message); return null; }
    finally { if (ctrl.current === c) setLoading(false); }
  }, [url]);
  return { data, error, loading, run, setData };
}
