import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

const BUCKET_NAME = "creatives";

const ALLOWED_MIME_TYPES = [
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "video/mp4", "video/quicktime", "video/x-msvideo", "video/webm",
];

export async function POST(request: NextRequest) {
    try {
        await getAuthenticatedContext(request);

        const { filename, mime_type } = await request.json();

        if (!filename || !mime_type) {
            return NextResponse.json(
                { error: "filename and mime_type are required" },
                { status: 400 }
            );
        }

        if (!ALLOWED_MIME_TYPES.includes(mime_type)) {
            return NextResponse.json(
                { error: "Unsupported file type" },
                { status: 400 }
            );
        }

        const supabase = createAdminClient();

        // Ensure bucket exists
        const { data: bucket } = await supabase.storage.getBucket(BUCKET_NAME);
        if (!bucket) {
            await supabase.storage.createBucket(BUCKET_NAME, {
                public: true,
                fileSizeLimit: 100 * 1024 * 1024,
                allowedMimeTypes: ALLOWED_MIME_TYPES,
            });
        }

        const ext = filename.split(".").pop() || "mp4";
        const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUploadUrl(path);

        if (error) {
            return NextResponse.json(
                { error: `Failed to create upload URL: ${error.message}` },
                { status: 500 }
            );
        }

        return NextResponse.json({
            signedUrl: data.signedUrl,
            path: data.path,
            token: data.token,
        });
    } catch (error) {
        return handleAuthError(error);
    }
}
