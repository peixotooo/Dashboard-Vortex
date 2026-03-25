import { createAdminClient } from "@/lib/supabase-admin";
import { decrypt } from "@/lib/encryption";
import type { EccosysConnection } from "@/types/hub";

interface EccosysConfig {
  apiToken: string;
  ambiente: string;
}

class EccosysClient {
  private lastRequest = 0;

  private async throttle() {
    const wait = 1100 - (Date.now() - this.lastRequest);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequest = Date.now();
  }

  async getConfig(workspaceId: string): Promise<EccosysConfig | null> {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("eccosys_connections")
      .select("api_token, ambiente")
      .eq("workspace_id", workspaceId)
      .single<Pick<EccosysConnection, "api_token" | "ambiente">>();

    if (!data) return null;
    return {
      apiToken: decrypt(data.api_token),
      ambiente: data.ambiente,
    };
  }

  private getBaseUrl(config: EccosysConfig): string {
    return `https://${config.ambiente}.eccosys.com.br/api`;
  }

  private getHeaders(config: EccosysConfig) {
    return {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  async get<T = unknown>(
    path: string,
    workspaceId: string,
    params?: Record<string, string>
  ): Promise<T> {
    const config = await this.getConfig(workspaceId);
    if (!config) throw new Error("Eccosys nao configurado para este workspace.");

    await this.throttle();
    const url = new URL(this.getBaseUrl(config) + path);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const res = await fetch(url.toString(), { headers: this.getHeaders(config) });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Eccosys ${res.status}: ${text}`);
    }
    return res.json();
  }

  async post<T = unknown>(
    path: string,
    body: unknown,
    workspaceId: string
  ): Promise<T> {
    const config = await this.getConfig(workspaceId);
    if (!config) throw new Error("Eccosys nao configurado para este workspace.");

    await this.throttle();
    const res = await fetch(this.getBaseUrl(config) + path, {
      method: "POST",
      headers: this.getHeaders(config),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Eccosys ${res.status}: ${text}`);
    }
    return res.json();
  }

  async put<T = unknown>(
    path: string,
    body: unknown,
    workspaceId: string
  ): Promise<T> {
    const config = await this.getConfig(workspaceId);
    if (!config) throw new Error("Eccosys nao configurado para este workspace.");

    await this.throttle();
    const res = await fetch(this.getBaseUrl(config) + path, {
      method: "PUT",
      headers: this.getHeaders(config),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Eccosys ${res.status}: ${text}`);
    }
    return res.json();
  }

  /**
   * Auto-paginate through all results.
   * Eccosys uses $offset + $count for pagination.
   */
  async listAll<T = unknown>(
    path: string,
    workspaceId: string,
    params?: Record<string, string>,
    pageSize = 50
  ): Promise<T[]> {
    const results: T[] = [];
    let offset = 0;
    while (true) {
      const page = await this.get<T[]>(path, workspaceId, {
        ...params,
        $offset: String(offset),
        $count: String(pageSize),
      });
      if (!Array.isArray(page) || page.length === 0) break;
      results.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return results;
  }

  /**
   * Direct config-based request (for testing connection before saving).
   */
  async testConnection(apiToken: string, ambiente: string): Promise<boolean> {
    await this.throttle();
    const url = `https://${ambiente}.eccosys.com.br/api/produtos?$count=1`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    });
    return res.ok;
  }
}

export const eccosys = new EccosysClient();
