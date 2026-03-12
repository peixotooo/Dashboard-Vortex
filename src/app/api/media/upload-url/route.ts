import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { generateKey, createPresignedUploadUrl } from "@/lib/b2-storage";

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

        const key = generateKey(filename);
        const signedUrl = await createPresignedUploadUrl(key, mime_type);

        return NextResponse.json({ signedUrl, key });
    } catch (error) {
        return handleAuthError(error);
    }
}
