"use client";

import React, { useEffect, useState, useCallback } from "react";
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
} from "lucide-react";

// --- Types ---

interface WapiGroup {
  id: string;
  name: string;
  description?: string;
  participants?: number;
}

interface SendResult {
  total: number;
  sent: number;
  failed: number;
  results: Array<{
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

  // Groups state
  const [groups, setGroups] = useState<WapiGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [groupSearch, setGroupSearch] = useState("");

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

  const fetchGroups = useCallback(async () => {
    if (!workspace?.id || !configured) return;
    setGroupsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/whatsapp-groups/groups", {
        headers: wsHeaders(),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(data.error);
      } else {
        setGroups(data.groups || []);
      }
    } catch (err) {
      setErrorMsg(
        `Erro ao carregar grupos: ${err instanceof Error ? err.message : "desconhecido"}`
      );
    }
    setGroupsLoading(false);
  }, [workspace?.id, configured, wsHeaders]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

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
            <p className="text-sm text-muted-foreground">
              {groups.length} grupo(s)
              {selectedGroups.size > 0 && (
                <span className="ml-2 text-primary font-medium">
                  | {selectedGroups.size} selecionado(s)
                </span>
              )}
            </p>
            <Button
              onClick={fetchGroups}
              disabled={groupsLoading || !configured || !connected}
              variant="outline"
              size="sm"
            >
              {groupsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Carregar Grupos
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
          {selectedGroups.size === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p>Nenhum grupo selecionado.</p>
                <p className="text-xs mt-1">
                  Selecione grupos na aba{" "}
                  <button
                    onClick={() => setActiveTab("groups")}
                    className="text-primary underline"
                  >
                    Grupos
                  </button>{" "}
                  antes de enviar.
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
                    <Select value={messageType} onValueChange={setMessageType}>
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

                  {/* Text message */}
                  {messageType === "text" && (
                    <div>
                      <Label>Mensagem</Label>
                      <Textarea
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        placeholder="Digite sua mensagem..."
                        rows={5}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Formatacao: *negrito*, _italico_, ~tachado~,
                        ```monoespaco```
                      </p>
                    </div>
                  )}

                  {/* Image */}
                  {messageType === "image" && (
                    <>
                      <div>
                        <Label>URL da imagem</Label>
                        <Input
                          value={mediaUrl}
                          onChange={(e) => setMediaUrl(e.target.value)}
                          placeholder="https://exemplo.com/imagem.jpg"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Formatos aceitos: PNG, JPEG, JPG
                        </p>
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

                  {/* Send button */}
                  <Button
                    onClick={handleSend}
                    disabled={sending || !canSend}
                    className="w-full"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Enviar para {selectedGroups.size} grupo(s)
                  </Button>
                </CardContent>
              </Card>

              {/* Send result */}
              {sendResult && (
                <Card
                  className={
                    sendResult.failed === 0
                      ? "border-green-500/30"
                      : "border-amber-500/30"
                  }
                >
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {sendResult.failed === 0 ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-amber-500" />
                      )}
                      Resultado do Envio
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
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
                      {sendResult.failed > 0 && (
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

                    {sendResult.results.some((r) => !r.sent) && (
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
                  </CardContent>
                </Card>
              )}
            </>
          )}
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
    </div>
  );
}
