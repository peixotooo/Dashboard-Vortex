"use client";

import { PixelAgent } from "./PixelAgent";
import type { AgentWithStats, DepartmentDef } from "./constants";

interface PixelOfficeRoomProps {
  department: DepartmentDef;
  agents: AgentWithStats[];
  onAgentClick: (agent: AgentWithStats) => void;
}

export function PixelOfficeRoom({
  department,
  agents,
  onAgentClick,
}: PixelOfficeRoomProps) {
  // Use 3 columns for large departments, 2 for small
  const cols = agents.length > 4 ? "grid-cols-3" : "grid-cols-2";

  return (
    <div
      className="rounded-xl p-4 bg-[#0f0f18] border transition-colors hover:border-opacity-40"
      style={{
        borderColor: department.color + "33",
        borderWidth: 1,
      }}
    >
      {/* Department header */}
      <div className="flex items-center gap-2 mb-4">
        <div
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: department.color }}
        />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {department.label}
        </span>
        <span className="text-[10px] text-muted-foreground/50 ml-auto">
          {agents.length}
        </span>
      </div>

      {/* Agents grid */}
      <div className={`grid ${cols} gap-4 justify-items-center`}>
        {agents.map((agent) => (
          <PixelAgent
            key={agent.id}
            agent={agent}
            onClick={onAgentClick}
            scale={3}
          />
        ))}
      </div>
    </div>
  );
}
