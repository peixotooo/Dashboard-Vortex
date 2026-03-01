"use client";

import { useRouter } from "next/navigation";
import { MessageSquare, Settings, Briefcase, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PixelAgentSprite } from "./PixelAgentSprite";
import type { AgentWithStats } from "./constants";

interface AgentPopoverProps {
  agent: AgentWithStats | null;
  open: boolean;
  onClose: () => void;
}

export function AgentPopover({ agent, open, onClose }: AgentPopoverProps) {
  const router = useRouter();

  if (!agent) return null;

  const isWorking = agent.active_tasks > 0;
  const isCmo = agent.slug === "coordenador";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-4">
            {/* Large pixel sprite */}
            <div className="shrink-0">
              <PixelAgentSprite
                color={agent.avatar_color}
                state={isWorking ? "working" : "idle"}
                slug={agent.slug}
                scale={5}
                isCmo={isCmo}
              />
            </div>
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                {agent.name}
                {isCmo && (
                  <span className="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full">
                    CMO
                  </span>
                )}
              </DialogTitle>
              <DialogDescription className="mt-1 line-clamp-2">
                {agent.description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Stats */}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5" />
            <span>
              {agent.active_tasks} task{agent.active_tasks !== 1 ? "s" : ""}{" "}
              ativa{agent.active_tasks !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            <span>
              {agent.total_deliverables} entrega
              {agent.total_deliverables !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Status + Active Task */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <div
              className={`w-2 h-2 rounded-full ${
                isWorking ? "bg-green-500" : "bg-gray-500"
              }`}
            />
            <span className="text-muted-foreground">
              {isWorking ? "Trabalhando" : "Disponivel"}
            </span>
          </div>
          {agent.active_task_title && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-4">
              <Briefcase className="h-3 w-3 text-green-500 shrink-0" />
              <span className="line-clamp-2">{agent.active_task_title}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            className="flex-1"
            onClick={() => {
              onClose();
              router.push(`/team/chat?agent=${agent.slug}`);
            }}
          >
            <MessageSquare className="h-4 w-4 mr-2" />
            Conversar
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onClose();
              router.push(`/team/agents/${agent.slug}/settings`);
            }}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
