const AUTH_FETCH_TIMEOUT_MS = 12_000;

export interface SupabaseAuthConfig {
  url: string;
  anonKey: string;
}

export function getSupabaseAuthConfig(): SupabaseAuthConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey || url === "your_supabase_url_here") return null;
  return { url, anonKey };
}

export function createSupabaseAuthFetch(
  requestSignal?: AbortSignal
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const signals = [requestSignal, init?.signal].filter(
      (signal): signal is AbortSignal => Boolean(signal)
    );
    const abortFromSignal = (signal: AbortSignal) => () =>
      controller.abort(signal.reason);

    const listeners = signals.map((signal) => {
      const listener = abortFromSignal(signal);
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener("abort", listener, { once: true });
      return { signal, listener };
    });
    const timeout = setTimeout(
      () =>
        controller.abort(
          new DOMException("Supabase Auth request timed out", "TimeoutError")
        ),
      AUTH_FETCH_TIMEOUT_MS
    );

    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      listeners.forEach(({ signal, listener }) =>
        signal.removeEventListener("abort", listener)
      );
    }
  };
}
