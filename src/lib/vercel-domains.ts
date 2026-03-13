const VERCEL_API = "https://api.vercel.com";

function getConfig() {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId || !teamId) {
    throw new Error("VERCEL_TOKEN, VERCEL_PROJECT_ID, and VERCEL_TEAM_ID are required");
  }

  return { token, projectId, teamId };
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export interface VercelDomainResult {
  name: string;
  verified: boolean;
  verification?: Array<{
    type: string;
    domain: string;
    value: string;
  }>;
}

export interface DomainConfigResult {
  configuredBy: string | null;
  misconfigured: boolean;
  cnames: string[];
  aValues: string[];
}

/**
 * Add a custom domain to the Vercel project.
 */
export async function addDomainToVercel(domain: string): Promise<VercelDomainResult> {
  const { token, projectId, teamId } = getConfig();

  const res = await fetch(
    `${VERCEL_API}/v9/projects/${projectId}/domains?teamId=${teamId}`,
    {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ name: domain }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Vercel API error: ${res.status}`);
  }

  const data = await res.json();
  return {
    name: data.name || domain,
    verified: data.verified ?? false,
    verification: data.verification,
  };
}

/**
 * Verify DNS configuration for a domain.
 */
export async function verifyDomainOnVercel(domain: string): Promise<VercelDomainResult> {
  const { token, projectId, teamId } = getConfig();

  const res = await fetch(
    `${VERCEL_API}/v9/projects/${projectId}/domains/${domain}/verify?teamId=${teamId}`,
    {
      method: "POST",
      headers: headers(token),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Vercel API error: ${res.status}`);
  }

  const data = await res.json();
  return {
    name: domain,
    verified: data.verified ?? false,
    verification: data.verification,
  };
}

/**
 * Get domain configuration details (DNS records status).
 */
export async function getDomainConfig(domain: string): Promise<DomainConfigResult> {
  const { token, teamId } = getConfig();

  const res = await fetch(
    `${VERCEL_API}/v6/domains/${domain}/config?teamId=${teamId}`,
    {
      method: "GET",
      headers: headers(token),
    }
  );

  if (!res.ok) {
    return { configuredBy: null, misconfigured: true, cnames: [], aValues: [] };
  }

  const data = await res.json();
  return {
    configuredBy: data.configuredBy || null,
    misconfigured: data.misconfigured ?? true,
    cnames: data.cnames || [],
    aValues: data.aValues || [],
  };
}

/**
 * Remove a domain from the Vercel project.
 */
export async function removeDomainFromVercel(domain: string): Promise<void> {
  const { token, projectId, teamId } = getConfig();

  const res = await fetch(
    `${VERCEL_API}/v9/projects/${projectId}/domains/${domain}?teamId=${teamId}`,
    {
      method: "DELETE",
      headers: headers(token),
    }
  );

  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Vercel API error: ${res.status}`);
  }
}

/**
 * Validate domain format.
 */
export function isValidDomain(domain: string): boolean {
  const re = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  return re.test(domain);
}
