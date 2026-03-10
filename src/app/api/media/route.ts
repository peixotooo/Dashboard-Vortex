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
        const { user } = await getAuthenticatedContext(request).catch(() => ({ user: null })) as { user: { id: string } | null };

        const formData = await request.formData();
        const file = formData.get("filename") as File | null;

        // Buffer the file BEFORE any upload consumes the stream
        let fileBuffer: ArrayBuffer | null = null;
        let fileName = "image.jpg";
        let fileType = "image/jpeg";
        let fileSize = 0;
        if (file && file instanceof File) {
            fileBuffer = await file.arrayBuffer();
            fileName = file.name;
            fileType = file.type || "image/jpeg";
            fileSize = file.size;
            // Replace the consumed File in FormData with a fresh copy from the buffer
            formData.set("filename", new File([fileBuffer], fileName, { type: fileType }));
        }

        // Upload to Meta (using the fresh File copy)
        const result = await uploadAdImage(formData);

        // Upload to Supabase Storage using the saved buffer (for Claude Vision URLs)
        let imageUrl: string | undefined;
        let storagePath: string | undefined;
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
                    storagePath = path;
                    const { data: urlData } = supabase.storage
                        .from(BUCKET_NAME)
                        .getPublicUrl(path);
                    imageUrl = urlData.publicUrl;
                }
            } catch {
                // Continue without Supabase Storage URL
            }
        }

        // Auto-register in workspace_media
        const workspaceId = request.headers.get("x-workspace-id");
        const metaResult = result as Record<string, unknown>;
        const imageHash = (metaResult.images as Array<{ hash: string }> | undefined)?.[0]?.hash;

        if (workspaceId && imageUrl) {
            try {
                const supabase = createAdminClient();
                await supabase.from("workspace_media").insert({
                    workspace_id: workspaceId,
                    filename: fileName,
                    image_url: imageUrl,
                    image_hash: imageHash || null,
                    storage_path: storagePath || null,
                    file_size: fileSize || null,
                    mime_type: fileType,
                    uploaded_by: user?.id || null,
                });
            } catch {
                // Continue without DB registration
            }
        }

        return NextResponse.json({ ...metaResult, imageUrl });
    } catch (error) {
        return handleAuthError(error);
    }
}

export async function GET(request: NextRequest) {
    try {
        await getAuthenticatedContext(request);

        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get("workspace_id");
        if (!workspaceId) {
            return NextResponse.json({ error: "workspace_id required" }, { status: 400 });
        }

        const search = searchParams.get("search") || "";
        const page = parseInt(searchParams.get("page") || "1", 10);
        const limit = parseInt(searchParams.get("limit") || "50", 10);
        const offset = (page - 1) * limit;

        const supabase = createAdminClient();
        let query = supabase
            .from("workspace_media")
            .select("*", { count: "exact" })
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);

        if (search) {
            query = query.ilike("filename", `%${search}%`);
        }

        const { data, count, error } = await query;
        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ data: data || [], total: count || 0, page, limit });
    } catch (error) {
        return handleAuthError(error);
    }
}

export async function DELETE(request: NextRequest) {
    try {
        await getAuthenticatedContext(request);

        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");
        if (!id) {
            return NextResponse.json({ error: "id required" }, { status: 400 });
        }

        const supabase = createAdminClient();

        // Fetch the record first to get storage_path
        const { data: media } = await supabase
            .from("workspace_media")
            .select("storage_path")
            .eq("id", id)
            .single();

        // Delete from Storage if path exists
        if (media?.storage_path) {
            await supabase.storage.from(BUCKET_NAME).remove([media.storage_path]);
        }

        // Delete from DB
        const { error } = await supabase.from("workspace_media").delete().eq("id", id);
        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return handleAuthError(error);
    }
}
