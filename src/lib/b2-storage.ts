import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

function getClient() {
    let endpoint = process.env.B2_ENDPOINT;
    const keyId = process.env.B2_KEY_ID;
    const appKey = process.env.B2_APPLICATION_KEY;

    if (!endpoint || !keyId || !appKey) {
        const missing = [];
        if (!endpoint) missing.push("B2_ENDPOINT");
        if (!keyId) missing.push("B2_KEY_ID");
        if (!appKey) missing.push("B2_APPLICATION_KEY");
        throw new Error(`B2 configuration missing: ${missing.join(", ")}`);
    }

    // Ensure endpoint has protocol
    if (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) {
        endpoint = `https://${endpoint}`;
    }

    try {
        return new S3Client({
            endpoint: endpoint,
            region: process.env.B2_REGION || "auto",
            forcePathStyle: true,
            credentials: {
                accessKeyId: keyId,
                secretAccessKey: appKey,
            },
        });
    } catch (err: any) {
        console.error("[B2] Failed to initialize S3Client:", err);
        throw new Error(`B2 Client Init Error: ${err.message}`);
    }
}

function getBucket() {
    const bucket = process.env.B2_BUCKET_NAME;
    if (!bucket) {
        throw new Error("B2_BUCKET_NAME is not configured");
    }
    return bucket;
}

function safePathSegment(value: string): string {
    return value
        .trim()
        .replace(/^\/+|\/+$/g, "")
        .split("/")
        .filter(Boolean)
        .map((part) => part.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""))
        .filter(Boolean)
        .join("/");
}

function safeExtension(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]+/g, "") || "bin";
    return ext.slice(0, 12) || "bin";
}

const MIME_EXTENSIONS: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "video/webm": "webm",
    "application/pdf": "pdf",
};

export function generateKey(
    filename: string,
    namespace = "creatives",
    contentType?: string
): string {
    const prefix = safePathSegment(namespace) || "creatives";
    const ext = (contentType && MIME_EXTENSIONS[contentType]) || safeExtension(filename);
    return `${prefix}/${Date.now()}-${randomUUID()}.${ext}`;
}

export function isSafeStorageKey(key: unknown, workspaceId?: string): key is string {
    if (typeof key !== "string") return false;
    if (!key || key.length > 500) return false;
    if (key.startsWith("/") || key.includes("\\") || key.includes("..")) return false;
    if (!/^[a-zA-Z0-9._/-]+$/.test(key)) return false;
    if (!/^(creatives|reviews)\//.test(key)) return false;

    if (workspaceId) {
        const wsPrefix = `creatives/${workspaceId}/`;
        const reviewPrefix = `reviews/${workspaceId}/`;
        if (key.startsWith(wsPrefix) || key.startsWith(reviewPrefix)) return true;

        // Backward compatibility for older keys generated before workspace
        // namespacing. They are still high-entropy, but new uploads are scoped.
        return /^creatives\/\d+-[a-zA-Z0-9._-]+\.[a-z0-9]+$/.test(key);
    }

    return true;
}

export async function createPresignedUploadUrl(key: string, contentType: string, contentLength?: number): Promise<string> {
    const client = getClient();
    const command = new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        ContentType: contentType,
        ...(Number.isFinite(contentLength) && contentLength && contentLength > 0
            ? { ContentLength: Math.floor(contentLength) }
            : {}),
    });
    return getSignedUrl(client, command, { expiresIn: 3600 });
}

export function getPublicUrl(key: string): string {
    const downloadUrl = process.env.B2_DOWNLOAD_URL;
    if (downloadUrl) {
        return `${downloadUrl.replace(/\/$/, "")}/${key}`;
    }

    const endpoint = process.env.B2_ENDPOINT!;
    const bucket = getBucket();
    
    // Backblaze S3 compatible endpoints usually look like: s3.<region>.backblazeb2.com
    // The "friendly" URL format is: https://<bucket>.s3.<region>.backblazeb2.com/<key>
    // OR: https://f00x.backblazeb2.com/file/<bucket>/<key>
    
    if (endpoint.includes("backblazeb2.com")) {
        // Try to construct a friendly URL if possible, otherwise fallback
        const host = endpoint.replace(/^https?:\/\//, "");
        return `https://${bucket}.${host}/${key}`;
    }

    return `${endpoint}/${bucket}/${key}`;
}

export async function uploadFile(key: string, body: Buffer | ArrayBuffer, contentType: string): Promise<string> {
    const client = getClient();
    await client.send(new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        Body: body instanceof ArrayBuffer ? Buffer.from(body) : body,
        ContentType: contentType,
    }));
    return getPublicUrl(key);
}

export async function downloadFile(key: string): Promise<Buffer> {
    const client = getClient();
    const res = await client.send(new GetObjectCommand({
        Bucket: getBucket(),
        Key: key,
    }));
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
}

export async function deleteFile(key: string): Promise<void> {
    const client = getClient();
    await client.send(new DeleteObjectCommand({
        Bucket: getBucket(),
        Key: key,
    }));
}
