"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  Hourglass,
  Loader2,
  ShieldAlert,
  Target,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/lib/workspace-context";
import {
  PRIORITY_COLOR,
  formatShortDateTime,
} from "@/lib/team/mission-control/format";

type Review = {
  total: number;
  generated_at: string;
  readyForReview: Array<{
    id: string;
    title: string;
    owner: string | null;
    priority: string;
    updated_at: string;
  }>;
  doneIncomplete: Array<{
    id: string;
    title: string;
    priority: string;
    missing: string[];
  }>;
  blockedHigh: Array<{
    id: string;
    title: string;
    priority: string;
    blocker: string | null;
    blocked_since: string | null;
  }>;
  noReplyFollowUps: Array<{
    id: string;
    demand_id: string | null;
    target_person: string;
    breach_hours: number | null;
    follow_up_number: number;
    due_reply_at_utc: string | null;
  }>;
  experimentsPendingDecision: Array<{
    id: string;
    title: string;
    priority: string;
    updated_at: string;
  }>;
};

// Needs COO Review = the morning scan. Everything that needs a human decision,
// grouped into five buckets so nothing slips through.
export default function CooReviewPage() {
  const { workspace } = useWorkspace();
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const res = await fetch("/api/team/mission-control/coo-review", {
        headers: { "x-workspace-id": workspace.id },
      });
      if (res.ok) {
        const data = await res.json();
        setReview(data.review);
      }
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !review) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/team/mission-control"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" /> Mission Control
        </Link>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2 mt-1">
          <CheckCircle2 className="h-7 w-7" />
          Needs COO Review
        </h1>
        <p className="text-muted-foreground mt-1">
          Tudo que precisa da sua cabeca agora. Total:{" "}
          <span className="font-semibold text-foreground">{review.total}</span>
        </p>
      </div>

      <Bucket
        icon={Target}
        title="Pronto para revisao"
        count={review.readyForReview.length}
        empty="Ninguem te esperando pra aprovar."
      >
        {review.readyForReview.map((d) => (
          <RowLink
            key={d.id}
            href={`/team/mission-control/${d.id}`}
            title={d.title}
            tag={
              <Badge className={PRIORITY_COLOR[d.priority]}>{d.priority}</Badge>
            }
            aside={`${d.owner ?? "-"} · atualizado ${formatShortDateTime(d.updated_at)}`}
          />
        ))}
      </Bucket>

      <Bucket
        icon={AlertTriangle}
        title="Concluidas sem fechamento completo"
        count={review.doneIncomplete.length}
        accent="amber"
        empty="Nenhuma done incompleta."
      >
        {review.doneIncomplete.map((d) => (
          <RowLink
            key={d.id}
            href={`/team/mission-control/${d.id}`}
            title={d.title}
            tag={
              <Badge className={PRIORITY_COLOR[d.priority]}>{d.priority}</Badge>
            }
            aside={`faltando: ${d.missing.join(", ")}`}
            asideIsBad
          />
        ))}
      </Bucket>

      <Bucket
        icon={ShieldAlert}
        title="Bloqueadas high/critical"
        count={review.blockedHigh.length}
        accent="red"
        empty="Nenhum bloqueio critico."
      >
        {review.blockedHigh.map((d) => (
          <RowLink
            key={d.id}
            href={`/team/mission-control/${d.id}`}
            title={d.title}
            tag={
              <Badge className={PRIORITY_COLOR[d.priority]}>{d.priority}</Badge>
            }
            aside={`${d.blocker ?? "sem descricao"}${
              d.blocked_since ? ` · desde ${formatShortDateTime(d.blocked_since)}` : ""
            }`}
            asideIsBad
          />
        ))}
      </Bucket>

      <Bucket
        icon={Hourglass}
        title="Follow-ups sem resposta (SLA estourado)"
        count={review.noReplyFollowUps.length}
        accent="amber"
        empty="Todo mundo respondeu no SLA."
      >
        {review.noReplyFollowUps.map((f) => (
          <RowLink
            key={f.id}
            href={
              f.demand_id
                ? `/team/mission-control/${f.demand_id}`
                : "/team/mission-control"
            }
            title={`${f.target_person} · follow-up #${f.follow_up_number}`}
            aside={
              f.breach_hours
                ? `${f.breach_hours.toFixed(1)}h overdue`
                : f.due_reply_at_utc
                ? `vencido em ${formatShortDateTime(f.due_reply_at_utc)}`
                : ""
            }
            asideIsBad
          />
        ))}
      </Bucket>

      <Bucket
        icon={FlaskConical}
        title="Experimentos em analise sem decisao"
        count={review.experimentsPendingDecision.length}
        empty="Nenhum experimento travado em analyzing."
      >
        {review.experimentsPendingDecision.map((e) => (
          <RowLink
            key={e.id}
            href="/team/mission-control/growth"
            title={e.title}
            tag={
              <Badge className={PRIORITY_COLOR[e.priority]}>{e.priority}</Badge>
            }
            aside={`atualizado ${formatShortDateTime(e.updated_at)}`}
          />
        ))}
      </Bucket>
    </div>
  );
}

function Bucket({
  icon: Icon,
  title,
  count,
  accent,
  empty,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  accent?: "red" | "amber";
  empty: string;
  children: React.ReactNode;
}) {
  const color =
    accent === "red"
      ? "border-red-400/50"
      : accent === "amber"
      ? "border-amber-400/50"
      : "";
  return (
    <Card className={color}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {title}
          <Badge variant="secondary" className="ml-1">
            {count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {count === 0 ? (
          <p className="text-xs text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function RowLink({
  href,
  title,
  tag,
  aside,
  asideIsBad,
}: {
  href: string;
  title: string;
  tag?: React.ReactNode;
  aside?: string;
  asideIsBad?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 py-1.5 border-b last:border-b-0 hover:bg-muted/40 rounded px-2"
    >
      <div className="flex items-center gap-2 min-w-0">
        {tag}
        <span className="text-sm truncate">{title}</span>
      </div>
      {aside && (
        <span
          className={`text-[11px] font-mono shrink-0 ${
            asideIsBad
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground"
          }`}
        >
          {aside}
        </span>
      )}
    </Link>
  );
}
