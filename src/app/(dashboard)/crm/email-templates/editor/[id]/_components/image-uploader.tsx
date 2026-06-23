"use client";

// ImageUploader — file input that uploads directly to Backblaze B2 via
// a presigned URL from /api/media/upload-url. Returns the resulting
// public URL via onUploaded().
//
// Direct browser → B2 upload (PUT to the presigned URL) keeps Vercel
// out of the data path, so even big images don't tax the function
// timeout. Auth is on the URL-issuance endpoint only — the presigned
// URL itself encodes the permission.

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Props {
  workspaceId: string;
  /** Called once the upload completes; the URL is the public B2 link
   *  that can be used as <img src> directly. */
  onUploaded: (publicUrl: string) => void;
  /** Visual label on the button. Default "Upload de imagem". */
  label?: string;
  /** Allowed MIME types (filtered client-side; server enforces too). */
  accept?: string;
  /** Disable while parent has another op in flight. */
  disabled?: boolean;
}

export function ImageUploader({
  workspaceId,
  onUploaded,
  label = "Upload de imagem",
  accept = "image/png,image/jpeg,image/webp,image/gif",
  disabled,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [doneAt, setDoneAt] = useState<number | null>(null);

  const pickFile = () => {
    if (uploading || disabled) return;
    setError(null);
    inputRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same filename
    if (!file) return;
    setError(null);
    setUploading(true);
    setProgress(0);
    setDoneAt(null);
    try {
      // 1. Ask our server for a presigned PUT url
      const r = await fetch("/api/media/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({ filename: file.name, mime_type: file.type }),
      });
      const d = await r.json();
      if (!r.ok || !d.signedUrl)
        throw new Error(d.error ?? "Falha ao gerar URL de upload.");
      const { signedUrl, publicUrl } = d as {
        signedUrl: string;
        publicUrl: string;
      };

      // 2. PUT the bytes directly to B2 with progress via XHR (fetch
      // doesn't expose upload progress).
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signedUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`B2 PUT falhou (HTTP ${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error("Erro de rede no upload."));
        xhr.send(file);
      });

      onUploaded(publicUrl);
      setDoneAt(Date.now());
      setProgress(100);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const justFinished = doneAt && Date.now() - doneAt < 4000;

  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFile}
        className="hidden"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={pickFile}
        disabled={uploading || disabled}
        className="w-full gap-1.5 text-xs"
      >
        {uploading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : justFinished ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Upload className="w-3.5 h-3.5" />
        )}
        {uploading
          ? `Enviando ${progress}%`
          : justFinished
            ? "Enviado · clique pra trocar"
            : label}
      </Button>
      {uploading && (
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {error && (
        <div className="text-[10px] text-destructive flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          {error}
        </div>
      )}
    </div>
  );
}
