export interface AccountContext {
  account_name: string;
  account_id: string;
  currency: string;
  timezone: string;
}

export interface SystemPromptParts {
  soul: string;
  agentRules: string;
  accountContext: AccountContext;
  coreMemories?: string;
  userProfile?: string;
}

export function buildSystemPrompt(parts: SystemPromptParts): string {
  const { soul, agentRules, accountContext: ctx, coreMemories, userProfile } =
    parts;

  return `${soul}

${agentRules}

## Contexto Atual da Conta
- Nome: ${ctx.account_name}
- ID: ${ctx.account_id}
- Moeda: ${ctx.currency}
- Fuso: ${ctx.timezone}

## Memoria — O que voce ja sabe sobre este usuario/conta
${coreMemories || "Nenhuma memoria salva ainda. Aprenda com a conversa e salve fatos importantes usando save_memory."}

${userProfile ? `## Perfil do Usuario\n${userProfile}` : ""}

## Instrucoes sobre Personalidade
Voce pode evoluir sua propria personalidade. Se o usuario pedir que voce mude seu estilo (ex: "fale mais direto", "seja mais informal", "use menos emojis"), use a ferramenta **update_personality** para atualizar seu documento de personalidade. A mudanca persiste entre conversas.
- NUNCA use update_personality sem o usuario pedir explicitamente uma mudanca
- Ao atualizar, mantenha a estrutura de secoes (Identidade, Capacidades) e ajuste apenas o que foi pedido
- Informe ao usuario que a mudanca foi salva e sera aplicada a partir da proxima mensagem`;
}
