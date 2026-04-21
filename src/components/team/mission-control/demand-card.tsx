"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Clock,
  Flame,
  Target,
  User,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Demand } from "@/lib/team/mission-control/types";
import {
  AREA_LABEL,
  HEALTH_COLOR,
  HEALTH_LABEL,
  PRIORITY_COLOR,
  STATUS_COLOR,
  STATUS_LABEL,
  formatShortDateTime,
  hoursOverdue,
} from "@/lib/team/mission-control/format";

interface Props {
  demand: Demand;
  onClick?: () => void;
  onCharge?: (id: string) => void;
}

// One card = everything Atlas needs to triage a demand at a glance:
// title, owner, status, health, last update, next follow-up, overdue hours,
// next action, expected impact.
export function DemandCard({ demand, onClick, onCharge }: Props) {
  const overdue =
    demand.waiting_for_person && demand.next_follow_up_at_utc
      ? hoursOverdue(demand.next_follow_up_at_utc)
      : 0;

  const impact =
    demand.revenue_impact ||
    demand.acquisition_impact ||
    demand.conversion_impact ||
    demand.retention_impact;

  const content = (
    <Card
      className={cn(
        "cursor-pointer hover:border-primary/40 transition-colors",
        overdue >= 3 && "border-red-400/60"
      )}
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <div
            className={cn(
              "h-2.5 w-2.5 rounded-full mt-1.5 shrink-0",
              STATUS_COLOR[demand.status]
            )}
          />
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium line-clamp-2">{demand.title}</h4>
            {demand.current_situation && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {demand.current_situation}
              </p>
            )}
          </div>
          {overdue >= 3 && (
            <Badge variant="destructive" className="text-[10px] gap-1 shrink-0">
              <AlertTriangle className="h-3 w-3" />
              overdue_3h
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            {STATUS_LABEL[demand.status]}
          </Badge>
          <Badge
            variant="secondary"
            className={cn("text-[10px]", PRIORITY_COLOR[demand.priority])}
          >
            {demand.priority}
          </Badge>
          <Badge
            variant="secondary"
            className={cn("text-[10px]", HEALTH_COLOR[demand.health])}
          >
            {HEALTH_LABEL[demand.health]}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {AREA_LABEL[demand.area]}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
          {demand.owner && (
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              <span className="truncate">{demand.owner}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>Atualizado {formatShortDateTime(demand.last_updated_at_utc)}</span>
          </div>
          {demand.next_follow_up_at_utc && (
            <div className="flex items-center gap-1 col-span-2">
              <Zap className="h-3 w-3" />
              <span className={cn(overdue >= 3 && "text-red-500 font-medium")}>
                Follow-up {formatShortDateTime(demand.next_follow_up_at_utc)}
                {overdue > 0 && ` · ${overdue}h overdue`}
              </span>
            </div>
          )}
          {demand.next_action && (
            <div className="flex items-center gap-1 col-span-2">
              <Target className="h-3 w-3" />
              <span className="truncate">{demand.next_action}</span>
            </div>
          )}
          {impact && (
            <div className="flex items-center gap-1 col-span-2">
              <Flame className="h-3 w-3" />
              <span className="truncate">{impact}</span>
            </div>
          )}
        </div>

        {demand.waiting_for_person && onCharge && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onCharge(demand.id);
            }}
            className="w-full text-[11px] px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-200 font-medium"
          >
            Cobrar {demand.waiting_for_person}
          </button>
        )}
      </CardContent>
    </Card>
  );

  return onClick ? content : (
    <Link href={`/team/mission-control/${demand.id}`}>{content}</Link>
  );
}
