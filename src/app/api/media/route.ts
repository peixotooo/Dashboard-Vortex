import { NextRequest, NextResponse } from "next/server";
import { uploadAdImage } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

const BUCKET_NAME = "creatives";

async function ensureBucket(supabase: ReturnType<typeof createAdminClient>) {
    const { data } = await supabase.storage.getBucket(BUCKET_NAME);
    if (!data) {
        await supabase.storage.createBucket(BUCKET_NAME, {
            public: true,
            fileSizeLimit: 10 * 1024 * 1024, // 10MB
            allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
        });
    }
}

export async function POST(request: NextRequest) {
    try {
        await getAuthenticatedContext(request).catch(() => { });

        const formData = await request.formData();
        const file = formData.get("filename") as File | null;

        // Buffer the file BEFORE any upload consumes the stream
        let fileBuffer: ArrayBuffer | null = null;
        let fileName = "image.jpg";
        let fileType = "image/jpeg";
        if (file && file instanceof File) {
            fileBuffer = await file.arrayBuffer();
            fileName = file.name;
            fileType = file.type || "image/jpeg";
            // Replace the consumed File in FormData with a fresh copy from the buffer
            formData.set("filename", new File([fileBuffer], fileName, { type: fileType }));
        }

        // Upload to Meta (using the fresh File copy)
        const result = await uploadAdImage(formData);

        // Upload to Supabase Storage using the saved buffer (for Claude Vision URLs)
        let imageUrl: string | undefined;
        if (fileBuffer) {
            try {
                const supabase = createAdminClient();
                await ensureBucket(supabase);

                const ext = fileName.split(".").pop() || "jpg";
                const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

                const { error } = await supabase.storage
                    .from(BUCKET_NAME)
                    .upload(path, fileBuffer, {
                        contentType: fileType,
                        upsert: false,
                    });

                if (!error) {
                    const { data: urlData } = supabase.storage
                        .from(BUCKET_NAME)
                        .getPublicUrl(path);
                    imageUrl = urlData.publicUrl;
                }
            } catch {
                // Continue without Supabase Storage URL
            }
        }

        return NextResponse.json({ ...(result as Record<string, unknown>), imageUrl });
    } catch (error) {
        return handleAuthError(error);
    }
}
