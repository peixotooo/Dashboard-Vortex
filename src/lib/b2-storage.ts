import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getClient() {
    if (!process.env.B2_ENDPOINT || !process.env.B2_KEY_ID || !process.env.B2_APPLICATION_KEY) {
        throw new Error(`B2 config missing: endpoint=${!!process.env.B2_ENDPOINT} keyId=${!!process.env.B2_KEY_ID} appKey=${!!process.env.B2_APPLICATION_KEY}`);
    }
    return new S3Client({
        endpoint: process.env.B2_ENDPOINT,
        region: process.env.B2_REGION || "auto",
        forcePathStyle: true,
        credentials: {
            accessKeyId: process.env.B2_KEY_ID,
            secretAccessKey: process.env.B2_APPLICATION_KEY,
        },
    });
}

function getBucket() {
    return process.env.B2_BUCKET_NAME!;
}

export function generateKey(filename: string): string {
    const ext = filename.split(".").pop() || "bin";
    return `creatives/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
}

export async function createPresignedUploadUrl(key: string, contentType: string): Promise<string> {
    const client = getClient();
    const command = new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        ContentType: contentType,
    });
    return getSignedUrl(client, command, { expiresIn: 3600 });
}

export function getPublicUrl(key: string): string {
    const endpoint = process.env.B2_ENDPOINT!;
    const bucket = getBucket();
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
