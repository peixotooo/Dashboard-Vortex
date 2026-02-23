import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client | null = null;
let connecting = false;
let connectPromise: Promise<Client> | null = null;

export async function getMcpClient(): Promise<Client> {
  if (client) return client;
  if (connecting && connectPromise) return connectPromise;

  connecting = true;
  connectPromise = createClient();

  try {
    client = await connectPromise;
    return client;
  } catch (error) {
    connecting = false;
    connectPromise = null;
    throw error;
  }
}

async function createClient(): Promise<Client> {
  // Use npx to run the published meta-ads-mcp package (pre-compiled)
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "meta-ads-mcp"],
    env: {
      ...process.env,
      META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || "",
      META_APP_ID: process.env.META_APP_ID || "",
      META_APP_SECRET: process.env.META_APP_SECRET || "",
      META_BUSINESS_ID: process.env.META_BUSINESS_ID || "",
      META_API_VERSION: process.env.META_API_VERSION || "v23.0",
    },
  });

  const newClient = new Client({
    name: "dashboard-vortex",
    version: "1.0.0",
  });

  await newClient.connect(transport);
  connecting = false;
  return newClient;
}

export async function callTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const c = await getMcpClient();
  const result = await c.callTool({ name, arguments: args });

  if (!result.content || !Array.isArray(result.content) || result.content.length === 0) {
    throw new Error("Empty response from MCP server");
  }

  const content = result.content[0];
  if (content.type === "text" && typeof content.text === "string") {
    try {
      return JSON.parse(content.text);
    } catch {
      return { text: content.text };
    }
  }

  return content;
}

export async function disconnectMcp(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    connecting = false;
    connectPromise = null;
  }
}
