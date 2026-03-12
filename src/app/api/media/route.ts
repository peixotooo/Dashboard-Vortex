import { NextRequest, NextResponse } from "next/server";
import { uploadAdImage, uploadAdVideo } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

const BUCKET_NAME = "creatives";

async function ensureBucket(supabase: ReturnType<typeof createAdminClient>) {
    const { data } = await supabase.storage.getBucket(BUCKET_NAME);
    if (!data) {
        await supabase.storage.createBucket(BUCKET_NAME, {
            public: true,
            fileSizeLimit: 100 * 1024 * 1024, // 100MB for videos
            allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"],
        });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { userId } = await getAuthenticatedContext(request).catch(() => ({ userId: null })) as { userId: string | null };

        const formData = await request.formData();
        const file = formData.get("filename") as File | null;
        const accountId = formData.get("account_id") as string || "";

        if (!file || !(file instanceof File)) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        const fileBuffer = await file.arrayBuffer();
        const fileName = file.name;
        const fileType = file.type || "image/jpeg";
        const fileSize = file.size;
        const isVideo = fileType.startsWith("video/");

        // 1. Upload to Supabase Storage FIRST (mandatory for both now, but critical for videos)
        const supabase = createAdminClient();
        await ensureBucket(supabase);

        const ext = fileName.split(".").pop() || (isVideo ? "mp4" : "jpg");
        const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

        const { error: storageError } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(path, fileBuffer, {
                contentType: fileType,
                upsert: false,
            });

        if (storageError) throw new Error(`Storage error: ${storageError.message}`);

        const { data: urlData } = supabase.storage
            .from(BUCKET_NAME)
            .getPublicUrl(path);
        const imageUrl = urlData.publicUrl;

        // 2. Upload to Meta
        let result: any;
        if (isVideo) {
            // Use file_url for videos to bypass body size limits!
            const videoMetaForm = new FormData();
            videoMetaForm.set("account_id", accountId);
            videoMetaForm.set("file_url", imageUrl);
            result = await uploadAdVideo(videoMetaForm);
        } else {
            // For images, source upload is fine (usually small)
            const imageMetaForm = new FormData();
            imageMetaForm.set("account_id", accountId);
            imageMetaForm.set("filename", new File([fileBuffer], fileName, { type: fileType }));
            result = await uploadAdImage(imageMetaForm);
        }

        // Auto-register in workspace_media
        const workspaceId = request.headers.get("x-workspace-id");
        
        let imageHash = null;
        let videoId = null;
        
        if (isVideo) {
            videoId = result.id || null;
        } else {
            const imagesRecords = result.images as Record<string, { hash: string }> | undefined;
            if (imagesRecords && Object.keys(imagesRecords).length > 0) {
                const firstKey = Object.keys(imagesRecords)[0];
                imageHash = imagesRecords[firstKey].hash;
            }
        }

        if (workspaceId) {
            try {
                await supabase.from("workspace_media").insert({
                    workspace_id: workspaceId,
                    filename: fileName,
                    image_url: imageUrl,
                    image_hash: imageHash,
                    video_id: videoId,
                    storage_path: path,
                    file_size: fileSize || null,
                    mime_type: fileType,
                    uploaded_by: userId || null,
                });
            } catch (err) {
                console.error("DB registration error:", err);
            }
        }

        return NextResponse.json({ 
            ...result, 
            imageUrl, 
            imageHash, 
            videoId, 
            mediaType: isVideo ? "video" : "image" 
        });
    } catch (error) {
        console.error("Upload error:", error);
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
