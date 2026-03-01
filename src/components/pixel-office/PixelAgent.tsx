"use client";

import { PixelAgentSprite } from "./PixelAgentSprite";
import { PixelDesk } from "./PixelDesk";
import type { AgentWithStats } from "./constants";

interface PixelAgentProps {
  agent: AgentWithStats;
  onClick: (agent: AgentWithStats) => void;
  scale?: number;
}

export function PixelAgent({ agent, onClick, scale = 3 }: PixelAgentProps) {
  const isWorking = agent.active_tasks > 0;
  const state = isWorking ? "working" : "idle";
  const isCmo = agent.slug === "coordenador";

  return (
    <div
      className="flex flex-col items-center cursor-pointer group"
      onClick={() => onClick(agent)}
      title={agent.name}
    >
      {/* Character sprite */}
      <div className="relative">
        <PixelAgentSprite
          color={agent.avatar_color}
          state={state}
          slug={agent.slug}
          scale={scale}
          isCmo={isCmo}
        />

        {/* Status dot */}
        <div
          className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-[#0f0f18] ${
            isWorking
              ? "bg-green-500 pixel-status-pulse"
              : "bg-gray-600"
          }`}
        />
      </div>

      {/* Desk */}
      <div className="-mt-1">
        <PixelDesk working={isWorking} scale={scale} />
      </div>

      {/* Name label */}
      <span className="mt-1 text-[10px] font-mono text-muted-foreground text-center leading-tight max-w-[60px] truncate group-hover:text-foreground transition-colors">
        {agent.name}
      </span>
    </div>
  );
}
