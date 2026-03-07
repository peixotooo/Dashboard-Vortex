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

        // Get the file before forwarding to Meta (FormData is consumed once)
        const file = formData.get("filename") as File | null;

        // Upload to Meta
        const result = await uploadAdImage(formData);

        // Also upload to Supabase Storage for Claude Vision (URL-based)
        let imageUrl: string | undefined;
        if (file && file instanceof File) {
            try {
                const supabase = createAdminClient();
                await ensureBucket(supabase);

                const ext = file.name.split(".").pop() || "jpg";
                const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

                const { error } = await supabase.storage
                    .from(BUCKET_NAME)
                    .upload(path, file, {
                        contentType: file.type || "image/jpeg",
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
