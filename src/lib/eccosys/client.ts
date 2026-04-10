interface EccosysConfig {
  apiToken: string;
  ambiente: string;
}

/**
 * Validates that an ambiente name is a safe hostname component.
 * Prevents SSRF by allowing only alphanumeric chars and hyphens
 * (no dots, slashes, colons, or other URL-special characters).
 */
const SAFE_AMBIENTE_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function isValidAmbiente(ambiente: string): boolean {
  return SAFE_AMBIENTE_RE.test(ambiente);
}

class EccosysClient {
  private lastRequest = 0;

  private async throttle() {
    const wait = 1000 - (Date.now() - this.lastRequest);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequest = Date.now();
  }

  /**
   * Read credentials from environment variables.
   * Token is stored in Vercel env — never touches the database.
   */
  getConfig(): EccosysConfig | null {
    const apiToken = process.env.ECCOSYS_API_TOKEN;
    const ambiente = (process.env.ECCOSYS_AMBIENTE || "producao").toLowerCase();

    if (!apiToken) return null;
    if (!isValidAmbiente(ambiente)) {
      throw new Error(
        `ECCOSYS_AMBIENTE invalido: "${ambiente}". Use apenas letras, numeros e hifens.`
      );
    }

    return { apiToken, ambiente };
  }

  /** Check if env vars are configured */
  isConfigured(): boolean {
    return !!process.env.ECCOSYS_API_TOKEN;
  }

  private getBaseUrl(config: EccosysConfig): string {
    if (!isValidAmbiente(config.ambiente)) {
      throw new Error(`Ambiente Eccosys invalido: ${config.ambiente}`);
    }
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
    _workspaceId?: string,
    params?: Record<string, string>
  ): Promise<T> {
    const config = this.getConfig();
    if (!config) throw new Error("Eccosys nao configurado. Defina ECCOSYS_API_TOKEN nas env vars da Vercel.");

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
    _workspaceId?: string
  ): Promise<T> {
    const config = this.getConfig();
    if (!config) throw new Error("Eccosys nao configurado. Defina ECCOSYS_API_TOKEN nas env vars da Vercel.");

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
    // Handle both JSON and plain text responses
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  async put<T = unknown>(
    path: string,
    body: unknown,
    _workspaceId?: string
  ): Promise<T> {
    const config = this.getConfig();
    if (!config) throw new Error("Eccosys nao configurado. Defina ECCOSYS_API_TOKEN nas env vars da Vercel.");

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
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  /**
   * GET returning raw text (for XML endpoints like /xml-nfes/).
   */
  async getText(
    path: string,
    _workspaceId?: string,
    params?: Record<string, string>
  ): Promise<string> {
    const config = this.getConfig();
    if (!config) throw new Error("Eccosys nao configurado. Defina ECCOSYS_API_TOKEN nas env vars da Vercel.");

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
    return res.text();
  }

  /**
   * Auto-paginate through all results.
   * Eccosys uses $offset + $count for pagination.
   */
  async listAll<T = unknown>(
    path: string,
    _workspaceId?: string,
    params?: Record<string, string>,
    pageSize = 50
  ): Promise<T[]> {
    const results: T[] = [];
    let offset = 0;
    while (true) {
      const page = await this.get<T[]>(path, undefined, {
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
   * POST with text/plain body (for Eccosys image upload endpoint).
   * POST /api/produtos/:id/imagens expects Content-Type: text/plain with URL or base64.
   */
  async postText(
    path: string,
    body: string,
    _workspaceId?: string
  ): Promise<unknown> {
    const config = this.getConfig();
    if (!config) throw new Error("Eccosys nao configurado. Defina ECCOSYS_API_TOKEN nas env vars da Vercel.");

    await this.throttle();
    const res = await fetch(this.getBaseUrl(config) + path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "text/plain",
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Eccosys ${res.status}: ${text}`);
    }
    return res.json().catch(() => ({}));
  }

  /**
   * Test connection with explicit credentials (for settings page).
   */
  async testConnection(apiToken: string, ambiente: string): Promise<boolean> {
    if (!isValidAmbiente(ambiente)) {
      throw new Error(`Ambiente Eccosys invalido: ${ambiente}`);
    }
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
