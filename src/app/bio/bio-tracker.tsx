"use client";

import { useEffect } from "react";

type TrackBlock = {
  id: string;
  type: string;
};

function getSessionId(): string {
  const key = "bkg_bio_session";
  try {
    const current = window.localStorage.getItem(key);
    if (current && /^[a-zA-Z0-9_-]+$/.test(current)) return current;
    const next = `bio_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    window.localStorage.setItem(key, next);
    document.cookie = `${key}=${encodeURIComponent(next)};path=/;max-age=${60 * 60 * 24 * 30};samesite=lax`;
    return next;
  } catch {
    return `bio_${Date.now().toString(36)}`;
  }
}

async function postEvent(payload: Record<string, unknown>) {
  try {
    await fetch(`/api/bio/track${window.location.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify(payload),
    });
  } catch {
    // Tracking must never affect navigation.
  }
}

export function BioTracker({
  workspaceId,
  blocks,
}: {
  workspaceId: string;
  blocks: TrackBlock[];
}) {
  useEffect(() => {
    const sessionId = getSessionId();
    const params = new URLSearchParams(window.location.search);
    void postEvent({
      workspace_id: workspaceId,
      event_name: "bio_viewed",
      session_id: sessionId,
      utm_source: params.get("utm_source") || "instagram",
      utm_medium: params.get("utm_medium") || "bio",
      utm_campaign: params.get("utm_campaign") || null,
      utm_content: params.get("utm_content") || null,
      metadata: {
        path: window.location.pathname,
        block_count: blocks.length,
      },
    });

    if (!("IntersectionObserver" in window)) return;

    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          const blockId = element.dataset.bioBlock || "";
          const blockType = element.dataset.bioType || "";
          if (!blockId || seen.has(blockId)) continue;
          seen.add(blockId);
          void postEvent({
            workspace_id: workspaceId,
            event_name: "bio_block_viewed",
            session_id: sessionId,
            block_id: blockId,
            block_type: blockType,
          });
        }
      },
      { threshold: 0.45 }
    );

    document.querySelectorAll<HTMLElement>("[data-bio-block]").forEach((element) => {
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, [workspaceId, blocks]);

  return null;
}
