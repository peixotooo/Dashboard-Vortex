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
} from "lucide-react";
import { FormattingToolbar } from "@/components/whatsapp/formatting-toolbar";
import { EmojiPicker } from "@/components/whatsapp/emoji-picker";
import { SchedulePicker } from "@/components/whatsapp/schedule-picker";
import { PresetManager, type Preset } from "@/components/whatsapp/preset-manager";
import { DispatchLog } from "@/components/whatsapp/dispatch-log";
import { GalleryPicker, type MediaItem } from "@/components/gallery-picker";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// --- Types ---

interface WapiGroup {
  id: string;
  name: string;
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

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Auto-load cached groups when configured
  useEffect(() => {
    if (configured) {
      fetchGroups(false);
      fetchPresets();
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mime_type: file.type,
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
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

                  {/* Send button */}
                  <Button
                    onClick={handleSend}
                    disabled={sending || !canSend}
                    className="w-full"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : isScheduled ? (
                      <Clock className="h-4 w-4 mr-2" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    {isScheduled
                      ? `Agendar envio para ${selectedGroups.size} grupo(s)`
                      : `Enviar agora para ${selectedGroups.size} grupo(s)`}
                  </Button>
                </CardContent>
              </Card>

              {/* Send result */}
              {sendResult && (
                <Card
                  className={
                    sendResult.status === "scheduled"
                      ? "border-blue-500/30"
                      : sendResult.failed === 0
                        ? "border-green-500/30"
                        : "border-amber-500/30"
                  }
                >
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {sendResult.status === "scheduled" ? (
                        <Clock className="h-5 w-5 text-blue-500" />
                      ) : sendResult.failed === 0 ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-amber-500" />
                      )}
                      {sendResult.status === "scheduled"
                        ? "Envio Agendado"
                        : "Resultado do Envio"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {sendResult.status === "scheduled" ? (
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
