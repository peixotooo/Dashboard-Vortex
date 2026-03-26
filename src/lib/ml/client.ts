import { createAdminClient } from "@/lib/supabase-admin";
import { encrypt, decrypt } from "@/lib/encryption";

const ML_BASE = "https://api.mercadolibre.com";

class MLClient {
  private lastRequest = 0;

  private async throttle() {
    const wait = 1100 - (Date.now() - this.lastRequest);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequest = Date.now();
  }

  /**
   * Get a valid access token for the workspace.
   * Auto-refreshes if less than 30 min until expiry.
   */
  async getToken(workspaceId: string): Promise<string> {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("ml_credentials")
      .select("*")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .single();

    if (!data) {
      throw new Error(
        "Mercado Livre nao conectado. Faca a autenticacao OAuth primeiro."
      );
    }

    const expiresAt = new Date(data.expires_at);
    // Refresh if less than 30 minutes until expiry
    if (expiresAt.getTime() - Date.now() < 30 * 60 * 1000) {
      return this.refresh(decrypt(data.refresh_token), data.id, workspaceId);
    }
    return decrypt(data.access_token);
  }

  /**
   * Refresh the ML token. refresh_token is single-use —
   * always save the new one from the response.
   */
  private async refresh(
    refreshToken: string,
    credId: string,
    workspaceId: string
  ): Promise<string> {
    const res = await fetch(`${ML_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.ML_APP_ID!,
        client_secret: process.env.ML_CLIENT_SECRET!,
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ML token refresh falhou: ${text}`);
    }

    const data = await res.json();

    const supabase = createAdminClient();
    await supabase
      .from("ml_credentials")
      .update({
        access_token: encrypt(data.access_token),
        refresh_token: encrypt(data.refresh_token),
        expires_at: new Date(
          Date.now() + data.expires_in * 1000
        ).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", credId);

    return data.access_token;
  }

  async get<T = unknown>(path: string, workspaceId: string): Promise<T> {
    await this.throttle();
    const token = await this.getToken(workspaceId);
    const res = await fetch(`${ML_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ML ${res.status}: ${text}`);
    }
    return res.json();
  }

  async post<T = unknown>(
    path: string,
    body: unknown,
    workspaceId: string
  ): Promise<T> {
    await this.throttle();
    const token = await this.getToken(workspaceId);
    const res = await fetch(`${ML_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ML ${res.status}: ${text}`);
    }
    return res.json();
  }

  async put<T = unknown>(
    path: string,
    body: unknown,
    workspaceId: string
  ): Promise<T> {
    await this.throttle();
    const token = await this.getToken(workspaceId);
    const res = await fetch(`${ML_BASE}${path}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ML ${res.status}: ${text}`);
    }
    return res.json();
  }

  /**
   * Upload an image to ML by downloading from URL and re-uploading as multipart.
   * Returns the ML picture ID (e.g. "909874-MLB109544132577_032026").
   */
  async uploadPicture(
    imageUrl: string,
    workspaceId: string
  ): Promise<string> {
    await this.throttle();
    const token = await this.getToken(workspaceId);

    // Download image
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status}`);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    // Upload as multipart
    const formData = new FormData();
    const blob = new Blob([imgBuffer], { type: "image/jpeg" });
    const filename = imageUrl.split("/").pop() || "image.jpg";
    formData.append("file", blob, filename);

    const res = await fetch(`${ML_BASE}/pictures/items/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ML picture upload ${res.status}: ${text}`);
    }
    const data = await res.json();
    return data.id;
  }

  /**
   * Check if ML credentials exist for the workspace.
   */
  async isConnected(workspaceId: string): Promise<boolean> {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("ml_credentials")
      .select("id")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .single();
    return !!data;
  }
}

export const ml = new MLClient();
