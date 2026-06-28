import { NextRequest, NextResponse } from "next/server";
import { AuthError, getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { generateKey, createPresignedUploadUrl, getPublicUrl } from "@/lib/b2-storage";

const MIME_LIMITS: Record<string, number> = {
    "image/jpeg": 12 * 1024 * 1024,
    "image/png": 12 * 1024 * 1024,
    "image/gif": 12 * 1024 * 1024,
    "image/webp": 12 * 1024 * 1024,
    "video/mp4": 80 * 1024 * 1024,
    "video/quicktime": 80 * 1024 * 1024,
    "video/x-msvideo": 80 * 1024 * 1024,
    "video/webm": 80 * 1024 * 1024,
    "application/pdf": 20 * 1024 * 1024,
};

const MAX_BODY_BYTES = 4096;

function validateFileSize(raw: unknown, mimeType: string): string | null {
    const limit = MIME_LIMITS[mimeType];
    const size = Number(raw);
    if (!Number.isFinite(size) || size <= 0) return "file_size is required";
    if (size > limit) return "File too large";
    return null;
}

export async function POST(request: NextRequest) {
    try {
        const { workspaceId } = await getWorkspaceContext(request);

        const contentLength = Number(request.headers.get("content-length") || "0");
        if (contentLength > MAX_BODY_BYTES) {
            return NextResponse.json({ error: "Payload too large" }, { status: 413 });
        }

        const { filename, mime_type, file_size } = await request.json();

        if (!filename || !mime_type) {
            return NextResponse.json(
                { error: "filename, mime_type and file_size are required" },
                { status: 400 }
            );
        }

        if (!Object.prototype.hasOwnProperty.call(MIME_LIMITS, mime_type)) {
            return NextResponse.json(
                { error: "Unsupported file type" },
                { status: 400 }
            );
        }

        const sizeError = validateFileSize(file_size, mime_type);
        if (sizeError) {
            return NextResponse.json(
                { error: sizeError },
                { status: sizeError === "File too large" ? 413 : 400 }
            );
        }

        const key = generateKey(filename, `creatives/${workspaceId}`);
        const signedUrl = await createPresignedUploadUrl(key, mime_type, Number(file_size));

        return NextResponse.json({ signedUrl, key, publicUrl: getPublicUrl(key) });
    } catch (error) {
        if (error instanceof AuthError) return handleAuthError(error);

        const msg = error instanceof Error ? error.message : "Unknown error";
        console.error("upload-url error:", msg);
        return NextResponse.json({ error: "Erro ao gerar URL de upload" }, { status: 500 });
    }
}
