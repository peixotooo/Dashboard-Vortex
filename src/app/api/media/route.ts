import { NextRequest, NextResponse } from "next/server";
import { uploadAdImage, uploadAdVideo } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getPublicUrl, uploadFile, downloadFile, deleteFile, generateKey } from "@/lib/b2-storage";

// Register file already in B2 — no Meta upload
async function handleRegisterOnly(request: NextRequest, userId: string | null) {
    const { storage_key, filename, mime_type, file_size, tags } = await request.json();

    if (!storage_key || !filename || !mime_type) {
        return NextResponse.json(
            { error: "storage_key, filename, and mime_type are required" },
            { status: 400 }
        );
    }

    const imageUrl = getPublicUrl(storage_key);
    const workspaceId = request.headers.get("x-workspace-id");

    if (!workspaceId) {
        return NextResponse.json({ error: "x-workspace-id header required" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase.from("workspace_media").insert({
        workspace_id: workspaceId,
        filename,
        image_url: imageUrl,
        image_hash: null,
        storage_path: storage_key,
        file_size: file_size || null,
        mime_type,
        tags: tags || [],
        uploaded_by: userId || null,
    }).select("id").single();

    if (error) {
        console.error("DB registration error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        id: data.id,
        imageUrl,
        filename,
        mediaType: mime_type.startsWith("video/") ? "video" : "image",
    });
}

async function handlePreUploadedFile(request: NextRequest, userId: string | null) {
    const { storage_key, account_id, filename, mime_type, file_size } = await request.json();

    if (!storage_key || !account_id || !filename || !mime_type) {
        return NextResponse.json(
            { error: "storage_key, account_id, filename, and mime_type are required" },
            { status: 400 }
        );
    }

    const isVideo = mime_type.startsWith("video/");
    const imageUrl = getPublicUrl(storage_key);

    console.log(`[MediaAPI] Handling pre-uploaded file: ${filename}, type: ${mime_type}, isVideo: ${isVideo}`);
    console.log(`[MediaAPI] B2 Public URL: ${imageUrl}`);

    let result: any;
    if (isVideo) {
        const videoMetaForm = new FormData();
        videoMetaForm.set("account_id", account_id);
        videoMetaForm.set("file_url", imageUrl);
        try {
            result = await uploadAdVideo(videoMetaForm);
            console.log("[MediaAPI] uploadAdVideo result (Meta ID):", result.id);
        } catch (err: any) {
            console.error("[MediaAPI] uploadAdVideo error:", err.message);
            return NextResponse.json({ error: `Meta Video Upload Error: ${err.message}` }, { status: 500 });
        }
    } else {
        // Meta doesn't support file_url for images in the simple upload endpoint,
        // but we still want the image in B2 for our own records and gallery.
        console.log("[MediaAPI] Downloading image from B2 for Meta upload...");
        const buffer = await downloadFile(storage_key);
        const imageMetaForm = new FormData();
        imageMetaForm.set("account_id", account_id);
        imageMetaForm.set("filename", new File([new Uint8Array(buffer)], filename, { type: mime_type }));
        try {
            result = await uploadAdImage(imageMetaForm);
            console.log("[MediaAPI] uploadAdImage result (Meta Hash):", result.images ? "Received" : "None");
        } catch (err: any) {
            console.error("[MediaAPI] uploadAdImage error:", err.message);
            return NextResponse.json({ error: `Meta Image Upload Error: ${err.message}` }, { status: 500 });
        }
    }

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

    const workspaceId = request.headers.get("x-workspace-id");
    if (workspaceId) {
        const supabase = createAdminClient();
        try {
            await supabase.from("workspace_media").insert({
                workspace_id: workspaceId,
                filename,
                image_url: imageUrl,
                image_hash: imageHash,
                video_id: videoId,
                storage_path: storage_key,
                file_size: file_size || null,
                mime_type,
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
        mediaType: isVideo ? "video" : "image",
    });
}

export async function POST(request: NextRequest) {
    try {
        const { userId } = await getAuthenticatedContext(request).catch(() => ({ userId: null })) as { userId: string | null };

        const contentType = request.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            // Check if this is a register-only request (no Meta upload)
            const cloned = request.clone();
            const body = await cloned.json();
            if (!body.account_id) {
                return handleRegisterOnly(request, userId);
            }
            // Pre-uploaded files with Meta integration
            return handlePreUploadedFile(request, userId);
        }

        // Standard FormData upload (backward compat for small images)
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

        // 1. Upload to B2
        const key = generateKey(fileName);
        const imageUrl = await uploadFile(key, fileBuffer, fileType);

        // 2. Upload to Meta
        let result: any;
        if (isVideo) {
            const videoMetaForm = new FormData();
            videoMetaForm.set("account_id", accountId);
            videoMetaForm.set("file_url", imageUrl);
            result = await uploadAdVideo(videoMetaForm);
        } else {
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
            const supabase = createAdminClient();
            try {
                await supabase.from("workspace_media").insert({
                    workspace_id: workspaceId,
                    filename: fileName,
                    image_url: imageUrl,
                    image_hash: imageHash,
                    video_id: videoId,
                    storage_path: key,
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
            mediaType: isVideo ? "video" : "image",
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

        const tag = searchParams.get("tag");
        if (tag) {
            query = query.contains("tags", [tag]);
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

        // Fetch the record first to get storage_path (B2 key)
        const { data: media } = await supabase
            .from("workspace_media")
            .select("storage_path")
            .eq("id", id)
            .single();

        // Delete from B2 if key exists
        if (media?.storage_path) {
            try {
                await deleteFile(media.storage_path);
            } catch (err) {
                console.error("B2 delete error:", err);
            }
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
