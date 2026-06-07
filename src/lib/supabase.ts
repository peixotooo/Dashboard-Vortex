import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (client) return client;

  // .trim() defende contra uma env var com espaço/quebra de linha acidental
  // (ex.: "https://...supabase.co\n"), que quebraria a montagem das URLs.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !key || url === "your_supabase_url_here") {
    // Return a dummy client that won't crash during build
    // The auth context will handle the null user state
    return createBrowserClient(
      "https://placeholder.supabase.co",
      "placeholder-key"
    );
  }

  client = createBrowserClient(url, key, {
    global: {
      // Proteção contra requisições que travam (Supabase 504/522 sob saturação).
      // Aborta com um MOTIVO claro (não o críptico "signal is aborted without
      // reason") e preserva o signal que o supabase-js eventualmente passa, em
      // vez de descartá-lo. 20s dá folga para auth sob carga sem travar a UI.
      fetch: (input, init) => {
        const controller = new AbortController();
        const timeout = setTimeout(
          () =>
            controller.abort(
              new DOMException(
                "A conexão com o servidor demorou demais (timeout).",
                "TimeoutError"
              )
            ),
          20000
        );
        // Encadeia o signal que o supabase-js eventualmente passa, sem descartá-lo.
        const upstream = init?.signal;
        if (upstream) {
          if (upstream.aborted) controller.abort(upstream.reason);
          else upstream.addEventListener("abort", () => controller.abort(upstream.reason), { once: true });
        }
        return fetch(input, { ...init, signal: controller.signal }).finally(() =>
          clearTimeout(timeout)
        );
      },
    },
  });
  return client;
}
