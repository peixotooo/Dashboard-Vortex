"use client";

import { useState } from "react";
import { Crown } from "lucide-react";
import { PixelAgent } from "./PixelAgent";
import { PixelOfficeRoom } from "./PixelOfficeRoom";
import { AgentPopover } from "./AgentPopover";
import { DEPARTMENTS } from "./constants";
import type { AgentWithStats } from "./constants";

interface PixelOfficeProps {
  agents: AgentWithStats[];
}

export function PixelOffice({ agents }: PixelOfficeProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentWithStats | null>(
    null
  );

  const coordinator = agents.find((a) => a.slug === "coordenador");

  // Map agents to departments
  const departmentAgents = DEPARTMENTS.map((dept) => ({
    department: dept,
    agents: dept.slugs
      .map((slug) => agents.find((a) => a.slug === slug))
      .filter((a): a is AgentWithStats => !!a),
  }));

  return (
    <div
      className="rounded-2xl border border-border/50 p-6 overflow-auto"
      style={{
        background:
          "repeating-linear-gradient(0deg, transparent, transparent 23px, #1a1a2808 23px, #1a1a2808 24px), repeating-linear-gradient(90deg, transparent, transparent 23px, #1a1a2808 23px, #1a1a2808 24px), #0a0a12",
      }}
    >
      {/* Marcos CMO Office */}
      {coordinator && (
        <div
          className="mb-6 rounded-xl border p-6 flex flex-col items-center gap-3"
          style={{
            borderColor: coordinator.avatar_color + "40",
            background:
              "linear-gradient(180deg, #13132008 0%, #0f0f1a 100%)",
          }}
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            <Crown className="h-3.5 w-3.5 text-yellow-500" />
            Escritorio do CMO
          </div>
          <PixelAgent
            agent={coordinator}
            onClick={setSelectedAgent}
            scale={4}
          />
        </div>
      )}

      {/* Department rooms grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {departmentAgents.map(
          ({ department, agents: deptAgents }) =>
            deptAgents.length > 0 && (
              <PixelOfficeRoom
                key={department.id}
                department={department}
                agents={deptAgents}
                onAgentClick={setSelectedAgent}
              />
            )
        )}
      </div>

      {/* Agent detail popover */}
      <AgentPopover
        agent={selectedAgent}
        open={!!selectedAgent}
        onClose={() => setSelectedAgent(null)}
      />
    </div>
  );
}
