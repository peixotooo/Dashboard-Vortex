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
  agentSlug?: string;
  projectContext?: string;
}

export function buildSystemPrompt(parts: SystemPromptParts): string {
  const {
    soul,
    agentRules,
    accountContext: ctx,
    coreMemories,
    userProfile,
    agentSlug,
    projectContext,
  } = parts;

  // Team agents don't need Meta Ads context (except Lucas)
  const isTeamAgent = agentSlug && agentSlug !== "vortex";
  const isLucas = agentSlug === "lucas";

  const metaContext = (isTeamAgent && !isLucas)
    ? ""
    : `\n## Contexto Atual da Conta
- Nome: ${ctx.account_name}
- ID: ${ctx.account_id}
- Moeda: ${ctx.currency}
- Fuso: ${ctx.timezone}`;

  const memorySection = isTeamAgent
    ? ""
    : `\n## Memoria — O que voce ja sabe sobre este usuario/conta
${coreMemories || "Nenhuma memoria salva ainda. Aprenda com a conversa e salve fatos importantes usando save_memory."}`;

  const profileSection =
    userProfile ? `\n## Perfil do Usuario\n${userProfile}` : "";

  const personalitySection = isTeamAgent
    ? ""
    : `\n## Instrucoes sobre Personalidade
Voce pode evoluir sua propria personalidade. Se o usuario pedir que voce mude seu estilo (ex: "fale mais direto", "seja mais informal", "use menos emojis"), use a ferramenta **update_personality** para atualizar seu documento de personalidade. A mudanca persiste entre conversas.
- NUNCA use update_personality sem o usuario pedir explicitamente uma mudanca
- Ao atualizar, mantenha a estrutura de secoes (Identidade, Capacidades) e ajuste apenas o que foi pedido
- Informe ao usuario que a mudanca foi salva e sera aplicada a partir da proxima mensagem`;

  const projectContextSection = projectContext
    ? `\n## Contexto do Projeto
${projectContext}`
    : "";

  const teamToolsSection = isTeamAgent
    ? `\n## Ferramentas de Time
- Use **create_task** para criar tarefas no kanban e atribuir a membros do time
- Use **update_task** para atualizar status de tarefas
- Use **save_deliverable** para salvar entregas formatadas (copy, calendario, auditoria, estrategia, etc.)
- Sempre salve entregas usando save_deliverable para que fiquem visiveis no dashboard${
        isLucas
          ? `\n\n## Ferramentas de Meta Ads
- Voce tem acesso DIRETO a conta de anuncios do usuario via Meta Marketing API
- Use as ferramentas de Meta Ads para criar, gerenciar e analisar campanhas
- SEMPRE peca confirmacao antes de executar acoes de criacao ou alteracao
- Para budgets acima de R$500/dia, peca DUPLA confirmacao
- Nunca delete campanhas — apenas pause
- Budgets da API estao em centavos — divida por 100 para mostrar em Reais`
          : ""
      }`
    : "";

  return `${soul}

${agentRules}${projectContextSection}${metaContext}${memorySection}${profileSection}${personalitySection}${teamToolsSection}`;
}
