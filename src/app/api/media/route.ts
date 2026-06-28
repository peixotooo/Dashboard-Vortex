import { NextRequest, NextResponse } from "next/server";
import { runWithToken, uploadAdImage, uploadAdVideo } from "@/lib/meta-api";
import { getWorkspaceContext, handleAuthError, resolveTokenForAccount } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { getPublicUrl, uploadFile, downloadFile, deleteFile, generateKey, isSafeStorageKey } from "@/lib/b2-storage";

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

function validateMediaInput(
    workspaceId: string,
    storageKey: unknown,
    filename: unknown,
    mimeType: unknown,
    fileSize?: unknown
): string | null {
    if (typeof filename !== "string" || filename.trim().length === 0 || filename.length > 240) {
        return "Invalid filename";
    }
    if (typeof mimeType !== "string" || !Object.prototype.hasOwnProperty.call(MIME_LIMITS, mimeType)) {
        return "Unsupported file type";
    }
    if (!isSafeStorageKey(storageKey, workspaceId)) {
        return "Invalid storage key";
    }
    if (fileSize != null) {
        const size = Number(fileSize);
        if (!Number.isFinite(size) || size <= 0) return "Invalid file size";
        if (size > MIME_LIMITS[mimeType]) return "File too large";
    }
    return null;
}

// Register file already in B2 — no Meta upload
async function handleRegisterOnly(
    request: NextRequest,
    userId: string,
    workspaceId: string
) {
    const { storage_key, filename, mime_type, file_size, tags } = await request.json();

    if (!storage_key || !filename || !mime_type) {
        return NextResponse.json(
            { error: "storage_key, filename, and mime_type are required" },
            { status: 400 }
        );
    }

    const validationError = validateMediaInput(workspaceId, storage_key, filename, mime_type, file_size);
    if (validationError) {
        return NextResponse.json(
            { error: validationError },
            { status: validationError === "File too large" ? 413 : 400 }
        );
    }

    const imageUrl = getPublicUrl(storage_key);
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
        uploaded_by: userId,
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

async function handlePreUploadedFile(
    request: NextRequest,
    userId: string,
    workspaceId: string
) {
    const { storage_key, account_id, filename, mime_type, file_size } = await request.json();

    if (!storage_key || !account_id || !filename || !mime_type) {
        return NextResponse.json(
            { error: "storage_key, account_id, filename, and mime_type are required" },
            { status: 400 }
        );
    }

    const validationError = validateMediaInput(workspaceId, storage_key, filename, mime_type, file_size);
    if (validationError) {
        return NextResponse.json(
            { error: validationError },
            { status: validationError === "File too large" ? 413 : 400 }
        );
    }

    const isVideo = mime_type.startsWith("video/");
    const imageUrl = getPublicUrl(storage_key);
    const token = await resolveTokenForAccount(workspaceId, account_id);
    if (!token) {
        return NextResponse.json(
            { error: "No Meta token configured for this account" },
            { status: 400 }
        );
    }

    console.log(`[MediaAPI] Handling pre-uploaded file: ${filename}, type: ${mime_type}, isVideo: ${isVideo}`);
    console.log(`[MediaAPI] B2 Public URL: ${imageUrl}`);

    let result: any;
    if (isVideo) {
        const videoMetaForm = new FormData();
        videoMetaForm.set("account_id", account_id);
        videoMetaForm.set("file_url", imageUrl);
        try {
            result = await runWithToken(token, () => uploadAdVideo(videoMetaForm));
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
            result = await runWithToken(token, () => uploadAdImage(imageMetaForm));
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
            uploaded_by: userId,
        });
    } catch (err) {
        console.error("DB registration error:", err);
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
        const { userId, workspaceId } = await getWorkspaceContext(request);

        const contentType = request.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            // Check if this is a register-only request (no Meta upload)
            const cloned = request.clone();
            const body = await cloned.json();
            if (!body.account_id) {
                return handleRegisterOnly(request, userId, workspaceId);
            }
            // Pre-uploaded files with Meta integration
            return handlePreUploadedFile(request, userId, workspaceId);
        }

        // Standard FormData upload (backward compat for small images)
        const formData = await request.formData();
        const file = formData.get("filename") as File | null;
        const accountId = formData.get("account_id") as string || "";

        if (!file || !(file instanceof File)) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }
        if (!accountId) {
            return NextResponse.json({ error: "account_id is required" }, { status: 400 });
        }

        const token = await resolveTokenForAccount(workspaceId, accountId);
        if (!token) {
            return NextResponse.json(
                { error: "No Meta token configured for this account" },
                { status: 400 }
            );
        }

        const fileBuffer = await file.arrayBuffer();
        const fileName = file.name;
        const fileType = file.type || "image/jpeg";
        const fileSize = file.size;
        const isVideo = fileType.startsWith("video/");

        if (!Object.prototype.hasOwnProperty.call(MIME_LIMITS, fileType)) {
            return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
        }
        if (fileSize > MIME_LIMITS[fileType]) {
            return NextResponse.json({ error: "File too large" }, { status: 413 });
        }

        // 1. Upload to B2
        const key = generateKey(fileName, `creatives/${workspaceId}`);
        const imageUrl = await uploadFile(key, fileBuffer, fileType);

        // 2. Upload to Meta
        let result: any;
        if (isVideo) {
            const videoMetaForm = new FormData();
            videoMetaForm.set("account_id", accountId);
            videoMetaForm.set("file_url", imageUrl);
            result = await runWithToken(token, () => uploadAdVideo(videoMetaForm));
        } else {
            const imageMetaForm = new FormData();
            imageMetaForm.set("account_id", accountId);
            imageMetaForm.set("filename", new File([fileBuffer], fileName, { type: fileType }));
            result = await runWithToken(token, () => uploadAdImage(imageMetaForm));
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
                uploaded_by: userId,
            });
        } catch (err) {
            console.error("DB registration error:", err);
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
        const { workspaceId } = await getWorkspaceContext(request);

        const { searchParams } = new URL(request.url);
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
        const { workspaceId } = await getWorkspaceContext(request);

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
            .eq("workspace_id", workspaceId)
            .single();

        if (!media) {
            return NextResponse.json({ error: "Media not found" }, { status: 404 });
        }

        // Delete from B2 if key exists
        if (media?.storage_path) {
            try {
                await deleteFile(media.storage_path);
            } catch (err) {
                console.error("B2 delete error:", err);
            }
        }

        // Delete from DB
        const { error } = await supabase
            .from("workspace_media")
            .delete()
            .eq("id", id)
            .eq("workspace_id", workspaceId);
        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return handleAuthError(error);
    }
}
