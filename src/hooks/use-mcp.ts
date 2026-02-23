"use client";

import { useState, useCallback } from "react";

interface UseMcpOptions {
  onSuccess?: (data: unknown) => void;
  onError?: (error: string) => void;
}

export function useMcp(options?: UseMcpOptions) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callTool = useCallback(
    async (tool: string, args: Record<string, unknown> = {}) => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool, args }),
        });

        const data = await res.json();

        if (!res.ok || data.error) {
          const errorMsg = data.error || "Request failed";
          setError(errorMsg);
          options?.onError?.(errorMsg);
          return null;
        }

        options?.onSuccess?.(data);
        return data;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        setError(errorMsg);
        options?.onError?.(errorMsg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [options]
  );

  return { callTool, loading, error };
}

export function useApi<T = unknown>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(
    async (params?: Record<string, string>) => {
      setLoading(true);
      setError(null);

      try {
        const searchParams = params
          ? "?" + new URLSearchParams(params).toString()
          : "";
        const res = await fetch(`${url}${searchParams}`);
        const result = await res.json();

        if (!res.ok || result.error) {
          setError(result.error || "Request failed");
          return null;
        }

        setData(result);
        return result as T;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        setError(errorMsg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [url]
  );

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const result = await res.json();

        if (!res.ok || result.error) {
          setError(result.error || "Request failed");
          return null;
        }

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        setError(errorMsg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [url]
  );

  return { data, loading, error, fetch: fetch_, post };
}
