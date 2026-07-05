// /chat — Chat Commerce v2 (assistente de vendas GLOBAL da loja).
//
// Página pública standalone (fora do dashboard). Server component resolve a
// config no servidor a partir de uma API key pública (ASSISTANT_PUBLIC_KEY) e
// entrega o bootstrap ao client. A key é pública por natureza (a mesma do
// shelves.js embutido na loja); nenhum segredo cruza pro browser.

import type { Metadata } from "next";
import { validateApiKey } from "@/lib/shelves/api-key";
import { getAssistantSettings } from "@/lib/assistant/settings";
import { getVndaConfigAdmin } from "@/lib/vnda-api";
import { getActiveKnowledge } from "@/lib/assistant/knowledge";
import { getVitrine } from "@/lib/assistant/commerce";
import ChatCommerce, { type ChatBootstrap } from "./ChatCommerce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bulking — Assistente de compras",
  description: "Converse, descubra produtos e monte sua sacola direto no chat.",
  robots: { index: false, follow: false },
};

const WA_FALLBACK = "https://wa.me/5562942630062";

async function loadBootstrap(): Promise<ChatBootstrap | null> {
  const key = process.env.ASSISTANT_PUBLIC_KEY;
  if (!key) return null;

  const auth = await validateApiKey(key);
  if (!auth) return null;

  const settings = await getAssistantSettings(auth.workspaceId);
  if (!settings.enabled || !settings.globalEnabled) return null;

  // storeHost (checkout) + régua de brinde + MAIS VENDIDOS pro onboarding, em
  // paralelo. O carrossel de mais vendidos aparece já na tela inicial pra o
  // cliente entender na hora que o chat vende a loja toda.
  const [vnda, knowledge, bestsellers] = await Promise.all([
    getVndaConfigAdmin(auth.workspaceId).catch(() => null),
    getActiveKnowledge(auth.workspaceId, "home").catch(() => null),
    getVitrine(auth.workspaceId, "mais_vendidos", 8).catch(() => []),
  ]);

  const storeHost = vnda?.storeHost || "www.bulking.com.br";

  return {
    publicKey: key,
    title: settings.title || "Assistente Bulking",
    welcome:
      settings.globalWelcome ||
      "Bem-vindo à Bulking. Me diz o que você procura ou toca numa sugestão aqui embaixo.",
    suggestions: settings.globalSuggestions || [],
    askName: settings.askName,
    storeUrl: `https://${storeHost}`,
    whatsapp: WA_FALLBACK,
    giftSteps: knowledge?.giftBar?.active ? knowledge.giftBar.steps : [],
    bestsellers,
  };
}

export default async function ChatCommercePage() {
  const bootstrap = await loadBootstrap();

  if (!bootstrap) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-neutral-950 text-neutral-300 p-6 [color-scheme:dark]">
        <div className="text-center max-w-sm">
          <p className="text-lg font-semibold text-white">Assistente indisponível</p>
          <p className="text-sm text-neutral-400 mt-1.5">
            O chat de compras não está ativo no momento. Volte mais tarde ou fale
            com a gente pelo WhatsApp.
          </p>
          <a
            href={WA_FALLBACK}
            className="inline-block mt-5 rounded-full bg-white text-neutral-900 px-5 py-2.5 text-sm font-semibold"
          >
            Falar no WhatsApp
          </a>
        </div>
      </div>
    );
  }

  return <ChatCommerce bootstrap={bootstrap} />;
}
