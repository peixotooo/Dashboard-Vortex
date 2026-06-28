"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/workspace-context";
import {
  Users,
  Wifi,
  WifiOff,
  RefreshCw,
  Send,
  Settings,
  Loader2,
  AlertCircle,
  CheckCircle2,
  QrCode,
  Search,
  ImageIcon,
  Video,
  FileText,
  Music,
  MessageSquare,
  X,
  Clock,
  Upload,
  Image as ImageLucide,
  History,
  FileEdit,
  TrendingUp,
  Link2,
  Copy,
  ExternalLink,
  AlertTriangle,
  Plus,
  Save,
} from "lucide-react";
import { FormattingToolbar } from "@/components/whatsapp/formatting-toolbar";
import { EmojiPicker } from "@/components/whatsapp/emoji-picker";
import { SchedulePicker } from "@/components/whatsapp/schedule-picker";
import { PresetManager, type Preset } from "@/components/whatsapp/preset-manager";
import { DispatchLog } from "@/components/whatsapp/dispatch-log";
import { GroupMembersDashboard } from "@/components/whatsapp/group-members-dashboard";
import { GalleryPicker, type MediaItem } from "@/components/gallery-picker";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// --- Types ---

interface WapiGroup {
  id: string;
  name: string;
}

interface PoolGroup {
  id: string;
  groupJid: string;
  groupName: string;
  sequence: number | null;
  inviteUrl: string | null;
  status: "active" | "paused" | "full" | "archived";
  redirectCount: number;
  memberCount: number | null;
  lastCapturedAt: string | null;
  capacity: number;
  fillPct: number | null;
  isNearFull: boolean;
  isFull: boolean;
  inviteJob: {
    status: "queued" | "processing" | "retrying" | "failed";
    attempts: number;
    runAt: string;
    lastError: string | null;
    updatedAt: string;
  } | null;
}

interface GroupPool {
  id: string;
  name: string;
  slug: string;
  publicUrl: string;
  matchPattern: string | null;
  capacity: number;
  nearFullThreshold: number;
  active: boolean;
  groups: PoolGroup[];
  stats: {
    totalGroups: number;
    activeGroups: number;
    routeableGroups: number;
    openRouteableGroups: number;
    nearFullGroups: number;
    fullGroups: number;
    missingInviteLinks: number;
    queuedInviteLinks: number;
    failedInviteLinks: number;
    totalMembers: number;
    needsMoreGroups: boolean;
  };
}

interface SendResult {
  dispatch_id?: string;
  status?: string;
  scheduled_at?: string;
  total: number;
  sent?: number;
  failed?: number;
  results?: Array<{
    group: string;
    name?: string;
    sent: boolean;
    error?: string;
  }>;
}

// --- Component ---

export default function WhatsAppGroupsPage() {
  const { workspace } = useWorkspace();
  const [activeTab, setActiveTab] = useState("connection");

  // Config state
  const [configLoading, setConfigLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [configInstanceId, setConfigInstanceId] = useState("");
  const [configToken, setConfigToken] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  // Connection state
  const [connected, setConnected] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // Groups state
  const [groups, setGroups] = useState<WapiGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [groupSearch, setGroupSearch] = useState("");
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [groupsCached, setGroupsCached] = useState(false);

  // Pool management state
  const [pools, setPools] = useState<GroupPool[]>([]);
  const [poolsLoading, setPoolsLoading] = useState(false);
  const [poolSaving, setPoolSaving] = useState(false);
  const [poolInviteRefreshing, setPoolInviteRefreshing] = useState<string | null>(null);
  const [groupInviteRefreshing, setGroupInviteRefreshing] = useState<string | null>(null);
  const [poolDraft, setPoolDraft] = useState({
    name: "BULKING VIP",
    slug: "vip",
    matchPattern: "BULKING VIP",
    capacity: 1024,
    nearFullThreshold: 950,
  });

  // Presets
  const [presets, setPresets] = useState<Preset[]>([]);

  // Send state
  const [messageType, setMessageType] = useState<string>("text");
  const [messageText, setMessageText] = useState("");
  const [caption, setCaption] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileExtension, setFileExtension] = useState("pdf");
  const [delayMessage, setDelayMessage] = useState(1);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  // Rascunho: prepara tudo sem disparar; ativa manualmente no Histórico.
  const [saveAsDraft, setSaveAsDraft] = useState(false);

  // Gallery
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Textarea ref for formatting toolbar
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Messages
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const wsHeaders = useCallback(() => {
    return {
      "x-workspace-id": workspace?.id || "",
      "Content-Type": "application/json",
    };
  }, [workspace?.id]);

  // --- Data fetching ---

  const fetchConfig = useCallback(async () => {
    if (!workspace?.id) return;
    setConfigLoading(true);
    try {
      const res = await fetch("/api/whatsapp-groups/config", {
        headers: wsHeaders(),
      });
      const data = await res.json();
      setConfigured(data.configured || false);
      if (data.configured) {
        setConfigInstanceId(data.instanceId || "");
        setConnected(data.connected || false);
      }
    } catch {
      // ignore
    }
    setConfigLoading(false);
  }, [workspace?.id, wsHeaders]);

  const fetchStatus = useCallback(async () => {
    if (!workspace?.id || !configured) return;
    setStatusLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/whatsapp-groups/status", {
        headers: wsHeaders(),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(data.error);
      } else {
        setConnected(data.connected);
      }
    } catch (err) {
      setErrorMsg(
        `Erro ao verificar status: ${err instanceof Error ? err.message : "desconhecido"}`
      );
    }
    setStatusLoading(false);
  }, [workspace?.id, configured, wsHeaders]);

  const fetchQrCode = useCallback(async () => {
    if (!workspace?.id || !configured) return;
    setQrLoading(true);
    setErrorMsg(null);
    setQrCode(null);
    try {
      const res = await fetch("/api/whatsapp-groups/qr-code", {
        headers: wsHeaders(),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(data.error);
      } else {
        setQrCode(data.qrcode || null);
      }
    } catch (err) {
      setErrorMsg(
        `Erro ao gerar QR Code: ${err instanceof Error ? err.message : "desconhecido"}`
      );
    }
    setQrLoading(false);
  }, [workspace?.id, configured, wsHeaders]);

  const fetchGroups = useCallback(
    async (refresh = false) => {
      if (!workspace?.id || !configured) return;
      setGroupsLoading(true);
      setErrorMsg(null);
      try {
        const url = refresh
          ? "/api/whatsapp-groups/groups?refresh=true"
          : "/api/whatsapp-groups/groups";
        const res = await fetch(url, { headers: wsHeaders() });
        const data = await res.json();
        if (data.error) {
          setErrorMsg(data.error);
        } else {
          setGroups(data.groups || []);
          setSyncedAt(data.synced_at || null);
          setGroupsCached(data.cached || false);
        }
      } catch (err) {
        setErrorMsg(
          `Erro ao carregar grupos: ${err instanceof Error ? err.message : "desconhecido"}`
        );
      }
      setGroupsLoading(false);
    },
    [workspace?.id, configured, wsHeaders]
  );

  const fetchPresets = useCallback(async () => {
    if (!workspace?.id) return;
    try {
      const res = await fetch("/api/whatsapp-groups/presets", {
        headers: wsHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setPresets(data.presets || []);
      }
    } catch {
      // ignore
    }
  }, [workspace?.id, wsHeaders]);

  const fetchPools = useCallback(async () => {
    if (!workspace?.id || !configured) return;
    setPoolsLoading(true);
    try {
      const res = await fetch("/api/whatsapp-groups/pools", {
        headers: wsHeaders(),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(data.error);
      } else {
        setPools(data.pools || []);
      }
    } catch (err) {
      setErrorMsg(
        `Erro ao carregar gestao de grupos: ${err instanceof Error ? err.message : "desconhecido"}`
      );
    } finally {
      setPoolsLoading(false);
    }
  }, [workspace?.id, configured, wsHeaders]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (
      tab &&
      ["connection", "groups", "growth", "management", "send", "history", "config"].includes(tab)
    ) {
      setActiveTab(tab);
    }
  }, []);

  // Auto-load cached groups when configured
  useEffect(() => {
    if (configured) {
      fetchGroups(false);
      fetchPresets();
      fetchPools();
    }
  }, [configured]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Actions ---

  async function handleSaveConfig() {
    setSavingConfig(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/whatsapp-groups/config", {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({
          instanceId: configInstanceId,
          token: configToken,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(`Erro ao salvar: ${data.error}`);
      } else {
        setConfigured(true);
        setConfigToken("");
        setSuccessMsg("Configuracao salva com sucesso!");
      }
    } catch (err) {
      setErrorMsg(
        `Erro de rede: ${err instanceof Error ? err.message : "desconhecido"}`
      );
    }
    setSavingConfig(false);
  }

  function handleTabChange(tab: string) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === "connection") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", tab);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function handleCreatePool() {
    setPoolSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/whatsapp-groups/pools", {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify(poolDraft),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(`Erro ao criar pool: ${data.error}`);
      } else {
        setPools(data.pools || []);
        setSuccessMsg("Pool criado e grupos existentes sincronizados.");
      }
    } catch (err) {
      setErrorMsg(
        `Erro ao criar pool: ${err instanceof Error ? err.message : "desconhecido"}`
      );
    } finally {
      setPoolSaving(false);
    }
  }

  async function handleSavePool(
    pool: GroupPool,
    sync = false,
    options: { quiet?: boolean } = {}
  ): Promise<boolean> {
    setPoolSaving(true);
    if (!options.quiet) {
      setErrorMsg(null);
      setSuccessMsg(null);
    }
    try {
      const res = await fetch(`/api/whatsapp-groups/pools/${pool.id}`, {
        method: "PATCH",
        headers: wsHeaders(),
        body: JSON.stringify({
          name: pool.name,
          slug: pool.slug,
          matchPattern: pool.matchPattern || "",
          capacity: pool.capacity,
          nearFullThreshold: pool.nearFullThreshold,
          active: pool.active,
          sync,
          groups: pool.groups.map((g) => ({
            id: g.id,
            inviteUrl: g.inviteUrl || "",
            status: g.status,
            sequence: g.sequence,
            redirectCount: g.redirectCount,
          })),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(`Erro ao salvar pool: ${data.error}`);
        return false;
      } else {
        setPools(data.pools || []);
        if (!options.quiet) {
          const syncedCount =
            typeof data.syncResult?.groupsCount === "number"
              ? data.syncResult.groupsCount
              : null;
          setSuccessMsg(
            sync && syncedCount !== null
              ? `Pool sincronizado: ${syncedCount} grupo(s) lidos da W-API.`
              : sync
                ? "Pool sincronizado."
                : "Pool salvo."
          );
        }
        return true;
      }
    } catch (err) {
      setErrorMsg(
        `Erro ao salvar pool: ${err instanceof Error ? err.message : "desconhecido"}`
      );
      return false;
    } finally {
      setPoolSaving(false);
    }
  }

  async function handleRefreshPoolInvites(
    pool: GroupPool,
    force = false,
    groupJid: string | null = null
  ) {
    const missingCount = pool.stats.missingInviteLinks;
    let message =
      `A W-API vai colocar ${missingCount} grupo(s) ativo(s) sem link em uma fila de geracao. ` +
      "Se algum link antigo ja circulava fora daqui, ele pode parar de funcionar. Continuar?";
    if (force) {
      message =
        "A W-API vai renovar os links de convite de todos os grupos ativos deste link unico. Links antigos desses grupos podem parar de funcionar. Continuar?";
    }
    if (groupJid) {
      message =
        "Gerar/renovar o link de convite deste grupo pela W-API? Se houver um link antigo deste grupo circulando, ele pode parar de funcionar.";
    }

    if (!window.confirm(message)) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    const saved = await handleSavePool(pool, false, { quiet: true });
    if (!saved) return;

    if (groupJid) setGroupInviteRefreshing(groupJid);
    else setPoolInviteRefreshing(pool.id);
    try {
      const res = await fetch(`/api/whatsapp-groups/pools/${pool.id}/invite-links`, {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({ force, groupJid }),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(`Erro ao gerar links: ${data.error}`);
        return;
      }

      setPools(data.pools || []);
      const summary = data.summary || {};
      const failures = Number(summary.failed || 0);
      const updated = Number(summary.updated || 0);
      const queued = Number(summary.queued || 0);
      const retrying = Number(summary.retrying || 0);
      const remaining = Number(summary.remaining || 0);
      let message =
        `Fila criada: ${queued} grupo(s) enfileirado(s), ${updated} link(s) gerado(s) agora e ${remaining} pendente(s).`;
      if (failures > 0) {
        message = `Fila processada: ${updated} link(s) gerado(s), ${retrying} em retry e ${failures} falha(s).`;
      } else if (groupJid) {
        message = updated > 0 ? "Link gerado para este grupo." : "Grupo colocado na fila de geracao.";
      }
      setSuccessMsg(message);
    } catch (err) {
      setErrorMsg(
        `Erro ao gerar links: ${err instanceof Error ? err.message : "desconhecido"}`
      );
    } finally {
      if (groupJid) setGroupInviteRefreshing(null);
      else setPoolInviteRefreshing(null);
    }
  }

  function updatePool(poolId: string, patch: Partial<GroupPool>) {
    setPools((prev) =>
      prev.map((pool) => (pool.id === poolId ? { ...pool, ...patch } : pool))
    );
  }

  function updatePoolGroup(
    poolId: string,
    groupId: string,
    patch: Partial<PoolGroup>
  ) {
    setPools((prev) =>
      prev.map((pool) =>
        pool.id === poolId
          ? {
              ...pool,
              groups: pool.groups.map((group) =>
                group.id === groupId ? { ...group, ...patch } : group
              ),
            }
          : pool
      )
    );
  }

  async function copyPoolUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setSuccessMsg("Link copiado.");
    } catch {
      setErrorMsg("Nao consegui copiar o link automaticamente.");
    }
  }

  async function handleRestart() {
    if (!workspace?.id) return;
    setRestarting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/whatsapp-groups/restart", {
        method: "POST",
        headers: wsHeaders(),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(`Erro ao reiniciar: ${data.error}`);
      } else {
        setSuccessMsg(
          data.message || "Instancia reiniciada. Aguarde alguns segundos e clique em 'Verificar Status'."
        );
        // Wait a beat, then resync status + groups so the UI reflects post-restart state.
        setTimeout(() => {
          fetchStatus();
          fetchGroups(true);
        }, 4000);
      }
    } catch (err) {
      setErrorMsg(
        `Erro ao reiniciar: ${err instanceof Error ? err.message : "desconhecido"}`
      );
    }
    setRestarting(false);
  }

  async function handleDisconnect() {
    if (!workspace?.id) return;
    const ok = window.confirm(
      "Desconectar essa instancia? Voce vai precisar escanear o QR Code de novo para reconectar."
    );
    if (!ok) return;
    setDisconnecting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/whatsapp-groups/disconnect", {
        method: "POST",
        headers: wsHeaders(),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(`Erro ao desconectar: ${data.error}`);
      } else {
        setConnected(false);
        setQrCode(null);
        setSuccessMsg(
          "Instancia desconectada. Clique em 'Gerar QR Code' para reconectar."
        );
      }
    } catch (err) {
      setErrorMsg(
        `Erro ao desconectar: ${err instanceof Error ? err.message : "desconhecido"}`
      );
    }
    setDisconnecting(false);
  }

  async function handleSend() {
    if (selectedGroups.size === 0) return;
    setSending(true);
    setSendResult(null);
    setErrorMsg(null);

    const selectedGroupData = groups
      .filter((g) => selectedGroups.has(g.id))
      .map((g) => ({ jid: g.id, name: g.name }));

    try {
      const res = await fetch("/api/whatsapp-groups/send", {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({
          groups: selectedGroupData,
          messageType,
          message: messageText || undefined,
          caption: caption || undefined,
          mediaUrl: mediaUrl || undefined,
          fileName: fileName || undefined,
          extension: fileExtension || undefined,
          delayMessage,
          scheduled_at: scheduledAt ? scheduledAt.toISOString() : undefined,
          save_as_draft: saveAsDraft,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(data.error);
      } else {
        setSendResult(data);
      }
    } catch (err) {
      setErrorMsg(
        `Erro ao enviar: ${err instanceof Error ? err.message : "desconhecido"}`
      );
    }
    setSending(false);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !workspace?.id) return;

    setUploading(true);
    setErrorMsg(null);
    try {
      // Step 1: Get presigned URL
      const urlRes = await fetch("/api/media/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({
          filename: file.name,
          mime_type: file.type,
          file_size: file.size,
        }),
      });
      const { signedUrl, key, publicUrl } = await urlRes.json();

      // Step 2: Upload to B2
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signedUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.onload = () => (xhr.status < 400 ? resolve() : reject(new Error("Upload failed")));
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(file);
      });

      // Step 3: Register in DB with tag
      const regRes = await fetch("/api/media", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspace.id,
        },
        body: JSON.stringify({
          storage_key: key,
          filename: file.name,
          mime_type: file.type,
          file_size: file.size,
          tags: ["wapi-groups"],
        }),
      });
      const regData = await regRes.json();

      setMediaUrl(regData.imageUrl || publicUrl);
      setMediaPreview(regData.imageUrl || publicUrl);
    } catch (err) {
      setErrorMsg(
        `Erro no upload: ${err instanceof Error ? err.message : "desconhecido"}`
      );
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleGallerySelect(items: MediaItem[]) {
    if (items[0]) {
      setMediaUrl(items[0].image_url);
      setMediaPreview(items[0].image_url);
    }
  }

  function handleEmojiInsert(emoji: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      setMessageText((prev) => prev + emoji);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = messageText.slice(0, start);
    const after = messageText.slice(end);
    setMessageText(`${before}${emoji}${after}`);
    requestAnimationFrame(() => {
      textarea.focus();
      const pos = start + emoji.length;
      textarea.setSelectionRange(pos, pos);
    });
  }

  function toggleGroup(id: string) {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllGroups() {
    const filtered = filteredGroups;
    const allSelected = filtered.every((g) => selectedGroups.has(g.id));
    if (allSelected) {
      setSelectedGroups((prev) => {
        const next = new Set(prev);
        filtered.forEach((g) => next.delete(g.id));
        return next;
      });
    } else {
      setSelectedGroups((prev) => {
        const next = new Set(prev);
        filtered.forEach((g) => next.add(g.id));
        return next;
      });
    }
  }

  function applyPreset(jids: string[]) {
    setSelectedGroups(new Set(jids));
  }

  const filteredGroups = groups.filter(
    (g) =>
      !groupSearch ||
      g.name?.toLowerCase().includes(groupSearch.toLowerCase()) ||
      g.id.toLowerCase().includes(groupSearch.toLowerCase())
  );

  const canSend =
    selectedGroups.size > 0 &&
    ((messageType === "text" && messageText.trim().length > 0) ||
      (messageType !== "text" && mediaUrl.trim().length > 0));

  const isScheduled = scheduledAt !== null;

  // --- Render ---

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6" />
          WhatsApp Grupos
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Envie mensagens para grupos do WhatsApp via W-API
        </p>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">{errorMsg}</div>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-red-400 hover:text-red-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">{successMsg}</div>
          <button
            onClick={() => setSuccessMsg(null)}
            className="text-green-400 hover:text-green-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="connection" className="gap-1.5">
            {connected ? (
              <Wifi className="h-4 w-4" />
            ) : (
              <WifiOff className="h-4 w-4" />
            )}
            Conexao
          </TabsTrigger>
          <TabsTrigger value="groups" className="gap-1.5">
            <Users className="h-4 w-4" /> Grupos
            {selectedGroups.size > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs px-1.5">
                {selectedGroups.size}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="growth" className="gap-1.5">
            <TrendingUp className="h-4 w-4" /> Crescimento
          </TabsTrigger>
          <TabsTrigger value="management" className="gap-1.5">
            <Link2 className="h-4 w-4" /> Link unico
          </TabsTrigger>
          <TabsTrigger value="send" className="gap-1.5">
            <Send className="h-4 w-4" /> Enviar
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-4 w-4" /> Historico
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1.5">
            <Settings className="h-4 w-4" /> Configuracao
          </TabsTrigger>
        </TabsList>

        {/* ==================== CONNECTION TAB ==================== */}
        <TabsContent value="connection" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                {connected ? (
                  <Wifi className="h-5 w-5 text-green-500" />
                ) : (
                  <WifiOff className="h-5 w-5 text-red-500" />
                )}
                Status da Instancia
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!configured ? (
                <div className="text-sm text-muted-foreground">
                  Configure o Instance ID e Token na aba{" "}
                  <button
                    onClick={() => setActiveTab("config")}
                    className="text-primary underline"
                  >
                    Configuracao
                  </button>{" "}
                  antes de conectar.
                </div>
              ) : (
                <>
                  <div
                    className={`flex items-center gap-2 text-sm rounded-lg p-3 ${
                      connected
                        ? "text-green-600 bg-green-50 dark:bg-green-950/20"
                        : "text-red-600 bg-red-50 dark:bg-red-950/20"
                    }`}
                  >
                    {connected ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}
                    {connected
                      ? "WhatsApp conectado"
                      : "WhatsApp desconectado"}
                    <span className="text-muted-foreground ml-2">
                      | Instance: {configInstanceId}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={fetchStatus}
                      disabled={statusLoading}
                      variant="outline"
                      size="sm"
                    >
                      {statusLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-1" />
                      )}
                      Verificar Status
                    </Button>
                    {!connected && (
                      <Button
                        onClick={fetchQrCode}
                        disabled={qrLoading}
                        size="sm"
                      >
                        {qrLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <QrCode className="h-4 w-4 mr-1" />
                        )}
                        Gerar QR Code
                      </Button>
                    )}
                    {connected && (
                      <>
                        <Button
                          onClick={handleRestart}
                          disabled={restarting}
                          variant="outline"
                          size="sm"
                        >
                          {restarting ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                          ) : (
                            <RefreshCw className="h-4 w-4 mr-1" />
                          )}
                          Reiniciar instancia
                        </Button>
                        <Button
                          onClick={handleDisconnect}
                          disabled={disconnecting}
                          variant="destructive"
                          size="sm"
                        >
                          {disconnecting ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                          ) : (
                            <WifiOff className="h-4 w-4 mr-1" />
                          )}
                          Desconectar
                        </Button>
                      </>
                    )}
                  </div>

                  {qrCode && !connected && (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Escaneie o QR Code abaixo com o WhatsApp para conectar.
                        O QR Code expira a cada 20 segundos.
                      </p>
                      <div className="flex justify-center">
                        <img
                          src={qrCode}
                          alt="QR Code para conexao WhatsApp"
                          className="max-w-xs border rounded-lg"
                        />
                      </div>
                      <div className="flex justify-center gap-2">
                        <Button
                          onClick={fetchQrCode}
                          disabled={qrLoading}
                          variant="outline"
                          size="sm"
                        >
                          <RefreshCw className="h-4 w-4 mr-1" />
                          Renovar QR Code
                        </Button>
                        <Button
                          onClick={fetchStatus}
                          disabled={statusLoading}
                          variant="outline"
                          size="sm"
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          Ja escaneei
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== GROUPS TAB ==================== */}
        <TabsContent value="groups" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {groups.length} grupo(s)
                {selectedGroups.size > 0 && (
                  <span className="ml-2 text-primary font-medium">
                    | {selectedGroups.size} selecionado(s)
                  </span>
                )}
              </p>
              {syncedAt && (
                <p className="text-xs text-muted-foreground">
                  Sincronizado em{" "}
                  {format(new Date(syncedAt), "dd/MM/yyyy 'as' HH:mm", {
                    locale: ptBR,
                  })}
                  {groupsCached && " (cache)"}
                </p>
              )}
            </div>
            <Button
              onClick={() => fetchGroups(true)}
              disabled={groupsLoading || !configured || !connected}
              variant="outline"
              size="sm"
            >
              {groupsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Recarregar da API
            </Button>
          </div>

          {!configured && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Configure a W-API antes de carregar grupos.
              </CardContent>
            </Card>
          )}

          {configured && !connected && groups.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Conecte o WhatsApp na aba{" "}
                <button
                  onClick={() => setActiveTab("connection")}
                  className="text-primary underline"
                >
                  Conexao
                </button>{" "}
                antes de carregar grupos.
              </CardContent>
            </Card>
          )}

          {groups.length > 0 && (
            <>
              {/* Presets */}
              <PresetManager
                presets={presets}
                selectedGroups={selectedGroups}
                onApplyPreset={applyPreset}
                onPresetsChange={fetchPresets}
                workspaceId={workspace?.id || ""}
              />

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                    placeholder="Buscar por nome..."
                    className="pl-9 h-8 text-sm"
                  />
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2 w-10">
                        <input
                          type="checkbox"
                          checked={
                            filteredGroups.length > 0 &&
                            filteredGroups.every((g) =>
                              selectedGroups.has(g.id)
                            )
                          }
                          onChange={toggleAllGroups}
                          className="rounded"
                        />
                      </th>
                      <th className="text-left px-4 py-2 font-medium">Nome</th>
                      <th className="text-left px-4 py-2 font-medium">ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredGroups.map((g) => (
                      <tr
                        key={g.id}
                        className="hover:bg-muted/30 cursor-pointer"
                        onClick={() => toggleGroup(g.id)}
                      >
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selectedGroups.has(g.id)}
                            onChange={() => toggleGroup(g.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded"
                          />
                        </td>
                        <td className="px-4 py-2 font-medium">{g.name}</td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {g.id}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </TabsContent>

        {/* ==================== MANAGEMENT TAB ==================== */}
        <TabsContent value="management" className="space-y-4">
          {!configured ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Configure a W-API antes de gerenciar o link unico.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Plus className="h-5 w-5" />
                    Novo link unico de grupos
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_1fr_0.6fr_0.6fr_auto] md:items-end">
                  <div>
                    <Label>Nome</Label>
                    <Input
                      value={poolDraft.name}
                      onChange={(e) =>
                        setPoolDraft((prev) => ({ ...prev, name: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label>Slug</Label>
                    <Input
                      value={poolDraft.slug}
                      onChange={(e) =>
                        setPoolDraft((prev) => ({ ...prev, slug: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label>Padrao no nome</Label>
                    <Input
                      value={poolDraft.matchPattern}
                      onChange={(e) =>
                        setPoolDraft((prev) => ({
                          ...prev,
                          matchPattern: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label>Capacidade</Label>
                    <Input
                      type="number"
                      value={poolDraft.capacity}
                      onChange={(e) =>
                        setPoolDraft((prev) => ({
                          ...prev,
                          capacity: Number(e.target.value),
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label>Alerta</Label>
                    <Input
                      type="number"
                      value={poolDraft.nearFullThreshold}
                      onChange={(e) =>
                        setPoolDraft((prev) => ({
                          ...prev,
                          nearFullThreshold: Number(e.target.value),
                        }))
                      }
                    />
                  </div>
                  <Button onClick={handleCreatePool} disabled={poolSaving} className="gap-1.5">
                    {poolSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Criar
                  </Button>
                </CardContent>
              </Card>

              {poolsLoading && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    Carregando links...
                  </CardContent>
                </Card>
              )}

              {!poolsLoading && pools.length === 0 && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Nenhum link unico criado ainda.
                  </CardContent>
                </Card>
              )}

              {pools.map((pool) => (
                <Card key={pool.id}>
                  <CardHeader className="space-y-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Link2 className="h-5 w-5" />
                          {pool.name}
                        </CardTitle>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          <Badge variant={pool.active ? "default" : "secondary"}>
                            {pool.active ? "Ativo" : "Pausado"}
                          </Badge>
                          <Badge variant="outline">{pool.stats.totalGroups} grupos</Badge>
                          <Badge variant="outline">
                            {pool.stats.routeableGroups} com link
                          </Badge>
                          {pool.stats.queuedInviteLinks > 0 && (
                            <Badge variant="secondary">
                              {pool.stats.queuedInviteLinks} na fila
                            </Badge>
                          )}
                          {pool.stats.failedInviteLinks > 0 && (
                            <Badge variant="destructive">
                              {pool.stats.failedInviteLinks} falharam
                            </Badge>
                          )}
                          <Badge variant="outline">
                            {pool.stats.totalMembers} membros
                          </Badge>
                          <span className="font-mono text-xs">{pool.publicUrl}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => copyPoolUrl(pool.publicUrl)}
                          className="gap-1.5"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copiar link
                        </Button>
                        <Button size="sm" variant="outline" asChild className="gap-1.5">
                          <a href={pool.publicUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                            Abrir
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSavePool(pool, true)}
                          disabled={poolSaving || poolInviteRefreshing === pool.id}
                          className="gap-1.5"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Sincronizar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRefreshPoolInvites(pool)}
                          disabled={
                            poolSaving ||
                            poolInviteRefreshing === pool.id ||
                            pool.stats.missingInviteLinks === 0
                          }
                          className="gap-1.5"
                        >
                          {poolInviteRefreshing === pool.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Link2 className="h-3.5 w-3.5" />
                          )}
                          Preencher links
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleSavePool(pool)}
                          disabled={poolSaving || poolInviteRefreshing === pool.id}
                          className="gap-1.5"
                        >
                          {poolSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Salvar
                        </Button>
                      </div>
                    </div>

                    {pool.stats.needsMoreGroups && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          Todos os grupos com link estao perto do limite. Crie mais grupos
                          seguindo o padrao e clique em sincronizar.
                        </span>
                      </div>
                    )}

                    {pool.stats.missingInviteLinks > 0 && (
                      <div className="flex flex-col gap-3 rounded-lg border p-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            {pool.stats.missingInviteLinks} grupo(s) ativo(s) sem link de convite.
                            Use a W-API para colocar esses grupos em fila; o worker gera em
                            lotes pequenos para evitar limite de requisicao.
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRefreshPoolInvites(pool)}
                          disabled={poolSaving || poolInviteRefreshing === pool.id}
                          className="shrink-0 gap-1.5"
                        >
                          {poolInviteRefreshing === pool.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Link2 className="h-3.5 w-3.5" />
                          )}
                          Preencher agora
                        </Button>
                      </div>
                    )}

                    {pool.stats.missingInviteLinks === 0 && pool.stats.routeableGroups > 0 && (
                      <div className="flex items-start gap-2 rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-sm text-green-700 dark:text-green-300">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          Link unico pronto: todos os grupos ativos possuem convite e
                          entram no rodizio conforme ocupacao.
                        </span>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-[1fr_0.7fr_0.8fr_0.6fr_0.6fr_0.6fr]">
                      <div>
                        <Label>Nome</Label>
                        <Input
                          value={pool.name}
                          onChange={(e) => updatePool(pool.id, { name: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Slug</Label>
                        <Input
                          value={pool.slug}
                          onChange={(e) => updatePool(pool.id, { slug: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Padrao no nome</Label>
                        <Input
                          value={pool.matchPattern || ""}
                          onChange={(e) =>
                            updatePool(pool.id, { matchPattern: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label>Capacidade</Label>
                        <Input
                          type="number"
                          value={pool.capacity}
                          onChange={(e) =>
                            updatePool(pool.id, { capacity: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div>
                        <Label>Alerta</Label>
                        <Input
                          type="number"
                          value={pool.nearFullThreshold}
                          onChange={(e) =>
                            updatePool(pool.id, {
                              nearFullThreshold: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label>Status</Label>
                        <Select
                          value={pool.active ? "active" : "paused"}
                          onValueChange={(value) =>
                            updatePool(pool.id, { active: value === "active" })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Ativo</SelectItem>
                            <SelectItem value="paused">Pausado</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Grupo</th>
                            <th className="px-3 py-2 text-left font-medium">Membros</th>
                            <th className="px-3 py-2 text-left font-medium">Status</th>
                            <th className="px-3 py-2 text-left font-medium">Link de convite</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {pool.groups.map((group) => (
                            <tr key={group.id} className={group.isNearFull ? "bg-amber-500/5" : ""}>
                              <td className="px-3 py-3 align-top">
                                <div className="font-medium">{group.groupName}</div>
                                <div className="text-xs font-mono text-muted-foreground">
                                  {group.groupJid}
                                </div>
                              </td>
                              <td className="px-3 py-3 align-top">
                                <div className="flex min-w-32 items-center gap-2">
                                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className={`h-full ${
                                        group.isFull
                                          ? "bg-red-500"
                                          : group.isNearFull
                                            ? "bg-amber-500"
                                            : "bg-green-500"
                                      }`}
                                      style={{ width: `${group.fillPct ?? 0}%` }}
                                    />
                                  </div>
                                  <span className="w-16 text-right text-xs text-muted-foreground">
                                    {group.memberCount ?? "-"} / {group.capacity}
                                  </span>
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {group.redirectCount} clique(s)
                                </div>
                              </td>
                              <td className="px-3 py-3 align-top">
                                <Select
                                  value={group.status}
                                  onValueChange={(value) =>
                                    updatePoolGroup(pool.id, group.id, {
                                      status: value as PoolGroup["status"],
                                    })
                                  }
                                >
                                  <SelectTrigger className="h-8 w-32">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="active">Ativo</SelectItem>
                                    <SelectItem value="paused">Pausado</SelectItem>
                                    <SelectItem value="full">Cheio</SelectItem>
                                    <SelectItem value="archived">Arquivado</SelectItem>
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-3 py-3 align-top">
                                <div className="flex min-w-[320px] items-start gap-2">
                                  <div className="flex-1 space-y-1">
                                    <Input
                                      value={group.inviteUrl || ""}
                                      onChange={(e) =>
                                        updatePoolGroup(pool.id, group.id, {
                                          inviteUrl: e.target.value,
                                        })
                                      }
                                      placeholder="https://chat.whatsapp.com/..."
                                    />
                                    {group.inviteJob && !group.inviteUrl && (
                                      <div className="text-xs text-muted-foreground">
                                        {group.inviteJob.status === "failed"
                                          ? `Falhou: ${group.inviteJob.lastError || "sem detalhe"}`
                                          : group.inviteJob.status === "retrying"
                                            ? `Em retry (${group.inviteJob.attempts})`
                                            : group.inviteJob.status === "processing"
                                              ? "Gerando agora..."
                                              : "Na fila"}
                                      </div>
                                    )}
                                  </div>
                                  {!group.inviteUrl && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        handleRefreshPoolInvites(pool, false, group.groupJid)
                                      }
                                      disabled={
                                        poolSaving ||
                                        poolInviteRefreshing === pool.id ||
                                        groupInviteRefreshing === group.groupJid
                                      }
                                      className="shrink-0 gap-1.5"
                                    >
                                      {groupInviteRefreshing === group.groupJid ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Link2 className="h-3.5 w-3.5" />
                                      )}
                                      Gerar
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </TabsContent>

        {/* ==================== SEND TAB ==================== */}
        <TabsContent value="send" className="space-y-4">
          {/* Preset quick-select */}
          {presets.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Selecao rapida por preset
              </p>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => {
                  const isActive =
                    preset.group_jids.length > 0 &&
                    preset.group_jids.every((jid) => selectedGroups.has(jid));
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset.group_jids)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/50 hover:bg-muted border-border text-foreground"
                      }`}
                    >
                      <Users className="h-3 w-3" />
                      {preset.name}
                      <span className="text-xs opacity-70">
                        ({preset.group_jids.length})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedGroups.size === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p>Nenhum grupo selecionado.</p>
                <p className="text-xs mt-1">
                  {presets.length > 0
                    ? "Use um preset acima ou selecione grupos na aba "
                    : "Selecione grupos na aba "}
                  <button
                    onClick={() => setActiveTab("groups")}
                    className="text-primary underline"
                  >
                    Grupos
                  </button>
                  .
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline">
                  {selectedGroups.size} grupo(s) selecionado(s)
                </Badge>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Send className="h-5 w-5" />
                    Compor Mensagem
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Tipo de mensagem</Label>
                    <Select value={messageType} onValueChange={(v) => {
                      setMessageType(v);
                      setMediaUrl("");
                      setMediaPreview(null);
                    }}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">
                          <span className="flex items-center gap-2">
                            <MessageSquare className="h-3.5 w-3.5" /> Texto
                          </span>
                        </SelectItem>
                        <SelectItem value="image">
                          <span className="flex items-center gap-2">
                            <ImageIcon className="h-3.5 w-3.5" /> Imagem
                          </span>
                        </SelectItem>
                        <SelectItem value="video">
                          <span className="flex items-center gap-2">
                            <Video className="h-3.5 w-3.5" /> Video
                          </span>
                        </SelectItem>
                        <SelectItem value="audio">
                          <span className="flex items-center gap-2">
                            <Music className="h-3.5 w-3.5" /> Audio
                          </span>
                        </SelectItem>
                        <SelectItem value="document">
                          <span className="flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5" /> Documento
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Text message with formatting toolbar */}
                  {messageType === "text" && (
                    <div>
                      <Label>Mensagem</Label>
                      <div className="border rounded-md focus-within:ring-1 focus-within:ring-ring">
                        <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/30">
                          <FormattingToolbar
                            textareaRef={textareaRef}
                            value={messageText}
                            onChange={setMessageText}
                          />
                          <div className="w-px h-5 bg-border mx-1" />
                          <EmojiPicker onSelect={handleEmojiInsert} />
                        </div>
                        <Textarea
                          ref={textareaRef}
                          value={messageText}
                          onChange={(e) => setMessageText(e.target.value)}
                          placeholder="Digite sua mensagem..."
                          rows={5}
                          className="border-0 focus-visible:ring-0 rounded-t-none"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Use a barra de ferramentas ou: *negrito*, _italico_,
                        ~tachado~, ```monoespaco```
                      </p>
                    </div>
                  )}

                  {/* Image with gallery integration */}
                  {messageType === "image" && (
                    <>
                      <div>
                        <Label>Imagem</Label>
                        {mediaPreview ? (
                          <div className="relative mt-2 inline-block">
                            <img
                              src={mediaPreview}
                              alt="Preview"
                              className="max-h-40 rounded-lg border"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setMediaUrl("");
                                setMediaPreview(null);
                              }}
                              className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2 mt-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setGalleryOpen(true)}
                            >
                              <ImageLucide className="h-4 w-4 mr-1.5" />
                              Escolher da Galeria
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={uploading}
                            >
                              {uploading ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                              ) : (
                                <Upload className="h-4 w-4 mr-1.5" />
                              )}
                              Enviar nova
                            </Button>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/gif,image/webp"
                              className="hidden"
                              onChange={handleFileUpload}
                            />
                          </div>
                        )}
                        {!mediaPreview && (
                          <div className="mt-2">
                            <Input
                              value={mediaUrl}
                              onChange={(e) => setMediaUrl(e.target.value)}
                              placeholder="Ou cole uma URL: https://..."
                              className="text-sm"
                            />
                          </div>
                        )}
                      </div>
                      <div>
                        <Label>Legenda (opcional)</Label>
                        <Textarea
                          value={caption}
                          onChange={(e) => setCaption(e.target.value)}
                          placeholder="Legenda da imagem..."
                          rows={3}
                        />
                      </div>
                    </>
                  )}

                  {/* Video */}
                  {messageType === "video" && (
                    <>
                      <div>
                        <Label>URL do video</Label>
                        <Input
                          value={mediaUrl}
                          onChange={(e) => setMediaUrl(e.target.value)}
                          placeholder="https://exemplo.com/video.mp4"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Formato aceito: MP4
                        </p>
                      </div>
                      <div>
                        <Label>Legenda (opcional)</Label>
                        <Textarea
                          value={caption}
                          onChange={(e) => setCaption(e.target.value)}
                          placeholder="Legenda do video..."
                          rows={3}
                        />
                      </div>
                    </>
                  )}

                  {/* Audio */}
                  {messageType === "audio" && (
                    <div>
                      <Label>URL do audio</Label>
                      <Input
                        value={mediaUrl}
                        onChange={(e) => setMediaUrl(e.target.value)}
                        placeholder="https://exemplo.com/audio.mp3"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Formatos aceitos: MP3, OGG
                      </p>
                    </div>
                  )}

                  {/* Document */}
                  {messageType === "document" && (
                    <>
                      <div>
                        <Label>URL do documento</Label>
                        <Input
                          value={mediaUrl}
                          onChange={(e) => setMediaUrl(e.target.value)}
                          placeholder="https://exemplo.com/relatorio.pdf"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Nome do arquivo</Label>
                          <Input
                            value={fileName}
                            onChange={(e) => setFileName(e.target.value)}
                            placeholder="Relatorio Mensal"
                          />
                        </div>
                        <div>
                          <Label>Extensao</Label>
                          <Input
                            value={fileExtension}
                            onChange={(e) => setFileExtension(e.target.value)}
                            placeholder="pdf"
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Legenda (opcional)</Label>
                        <Textarea
                          value={caption}
                          onChange={(e) => setCaption(e.target.value)}
                          placeholder="Descricao do documento..."
                          rows={2}
                        />
                      </div>
                    </>
                  )}

                  {/* Delay */}
                  <div>
                    <Label>Delay entre mensagens (segundos)</Label>
                    <Select
                      value={String(delayMessage)}
                      onValueChange={(v) => setDelayMessage(Number(v))}
                    >
                      <SelectTrigger className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1s</SelectItem>
                        <SelectItem value="3">3s</SelectItem>
                        <SelectItem value="5">5s</SelectItem>
                        <SelectItem value="10">10s</SelectItem>
                        <SelectItem value="15">15s</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Recomendado: 5s ou mais para evitar bloqueios
                    </p>
                  </div>

                  {/* Schedule */}
                  <div>
                    <Label>Agendamento</Label>
                    <SchedulePicker
                      value={scheduledAt}
                      onChange={setScheduledAt}
                    />
                  </div>

                  {/* Modo rascunho */}
                  <div className="space-y-2 border rounded-md p-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                        <FileEdit className="h-3.5 w-3.5" />
                        Salvar como rascunho
                      </Label>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={saveAsDraft}
                        onClick={() => setSaveAsDraft((v) => !v)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors ${
                          saveAsDraft
                            ? "bg-foreground border-foreground"
                            : "bg-card border-border"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 mt-[2px] transform rounded-full bg-background transition ${
                            saveAsDraft ? "translate-x-5" : "translate-x-[2px]"
                          }`}
                        />
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {saveAsDraft
                        ? "Nada vai pra W-API agora. Fica como Rascunho no Histórico com a data prevista acima (opcional). Você clica em Ativar quando quiser disparar."
                        : "Sem rascunho: o envio sai imediato ou na data agendada."}
                    </p>
                  </div>

                  {/* Send button */}
                  <Button
                    onClick={handleSend}
                    disabled={sending || !canSend}
                    className="w-full"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : saveAsDraft ? (
                      <FileEdit className="h-4 w-4 mr-2" />
                    ) : isScheduled ? (
                      <Clock className="h-4 w-4 mr-2" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    {saveAsDraft
                      ? isScheduled
                        ? `Salvar rascunho (${selectedGroups.size} grupo(s))`
                        : `Salvar rascunho (${selectedGroups.size} grupo(s))`
                      : isScheduled
                      ? `Agendar envio para ${selectedGroups.size} grupo(s)`
                      : `Enviar agora para ${selectedGroups.size} grupo(s)`}
                  </Button>
                </CardContent>
              </Card>

              {/* Send result */}
              {sendResult && (
                <Card
                  className={
                    sendResult.status === "draft"
                      ? "border-muted-foreground/30"
                      : sendResult.status === "scheduled"
                      ? "border-blue-500/30"
                      : sendResult.failed === 0
                        ? "border-green-500/30"
                        : "border-amber-500/30"
                  }
                >
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {sendResult.status === "draft" ? (
                        <FileEdit className="h-5 w-5 text-muted-foreground" />
                      ) : sendResult.status === "scheduled" ? (
                        <Clock className="h-5 w-5 text-blue-500" />
                      ) : sendResult.failed === 0 ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-amber-500" />
                      )}
                      {sendResult.status === "draft"
                        ? "Rascunho salvo"
                        : sendResult.status === "scheduled"
                        ? "Envio Agendado"
                        : "Resultado do Envio"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {sendResult.status === "draft" ? (
                      <div className="text-sm">
                        <p>
                          Rascunho salvo para {sendResult.total} grupo(s).
                          {sendResult.scheduled_at && (
                            <>
                              {" "}Data prevista:{" "}
                              <strong>
                                {format(
                                  new Date(sendResult.scheduled_at),
                                  "dd/MM/yyyy 'as' HH:mm",
                                  { locale: ptBR }
                                )}
                              </strong>
                              .
                            </>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Vá na aba <strong>Histórico</strong> e clique em
                          Ativar quando quiser disparar.
                        </p>
                      </div>
                    ) : sendResult.status === "scheduled" ? (
                      <div className="text-sm">
                        <p>
                          Mensagem agendada para{" "}
                          <strong>
                            {sendResult.scheduled_at &&
                              format(
                                new Date(sendResult.scheduled_at),
                                "dd/MM/yyyy 'as' HH:mm",
                                { locale: ptBR }
                              )}
                          </strong>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Sera enviada para {sendResult.total} grupo(s). Veja o
                          status na aba Historico.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-4 text-sm">
                          <div className="text-center">
                            <div className="font-bold text-lg">
                              {sendResult.total}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Total
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="font-bold text-lg text-green-600">
                              {sendResult.sent}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Enviadas
                            </div>
                          </div>
                          {(sendResult.failed ?? 0) > 0 && (
                            <div className="text-center">
                              <div className="font-bold text-lg text-red-600">
                                {sendResult.failed}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Falhas
                              </div>
                            </div>
                          )}
                        </div>

                        {sendResult.results?.some((r) => !r.sent) && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-red-400">
                              Erros:
                            </p>
                            {sendResult.results
                              .filter((r) => !r.sent)
                              .map((r, i) => (
                                <div
                                  key={i}
                                  className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1"
                                >
                                  {r.name || r.group}: {r.error}
                                </div>
                              ))}
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ==================== HISTORY TAB ==================== */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="h-5 w-5" />
                Historico de Disparos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DispatchLog workspaceId={workspace?.id || ""} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== GROWTH TAB ==================== */}
        <TabsContent value="growth" className="space-y-4">
          <GroupMembersDashboard />
        </TabsContent>

        {/* ==================== CONFIG TAB ==================== */}
        <TabsContent value="config" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Configuracao W-API
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {configured && (
                <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 dark:bg-green-950/20 rounded-lg p-3">
                  <CheckCircle2 className="h-4 w-4" />
                  W-API configurado | Instance: {configInstanceId}
                </div>
              )}

              <div>
                <Label>Instance ID</Label>
                <Input
                  value={configInstanceId}
                  onChange={(e) => setConfigInstanceId(e.target.value)}
                  placeholder="Ex: T34398-VYR3QD-MS29SL"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Encontre o Instance ID no painel da W-API em
                  painel.w-api.app
                </p>
              </div>

              <div>
                <Label>Token</Label>
                <Textarea
                  value={configToken}
                  onChange={(e) => setConfigToken(e.target.value)}
                  placeholder={
                    configured
                      ? "Novo token (deixe em branco para manter o atual)"
                      : "Cole o token de autenticacao da W-API"
                  }
                  rows={3}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  O token sera armazenado criptografado. Encontre-o no painel
                  da W-API junto ao Instance ID.
                </p>
              </div>

              <Button
                onClick={handleSaveConfig}
                disabled={
                  savingConfig ||
                  !configInstanceId ||
                  (!configToken && !configured)
                }
              >
                {savingConfig ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Salvar Configuracao
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Gallery Picker Dialog */}
      <GalleryPicker
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        workspaceId={workspace?.id || ""}
        onSelect={handleGallerySelect}
        skipMetaValidation
        singleSelect
      />
    </div>
  );
}
