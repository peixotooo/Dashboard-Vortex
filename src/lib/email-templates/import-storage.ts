import { createAdminClient } from "@/lib/supabase-admin";

export const EMAIL_IMPORT_BUCKET = "email-list-imports";
const MAX_IMPORT_FILE_SIZE = 50 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;

let ensureBucketPromise: Promise<void> | null = null;

async function configurePrivateBucket(): Promise<void> {
  const admin = createAdminClient();
  const { data: bucket } = await admin.storage.getBucket(EMAIL_IMPORT_BUCKET);

  if (!bucket) {
    const { error } = await admin.storage.createBucket(EMAIL_IMPORT_BUCKET, {
      public: false,
      fileSizeLimit: MAX_IMPORT_FILE_SIZE,
      allowedMimeTypes: ["text/csv", "text/plain"],
    });
    if (error) {
      throw new Error(`Falha ao criar bucket privado: ${error.message}`);
    }
    return;
  }

  const { error } = await admin.storage.updateBucket(EMAIL_IMPORT_BUCKET, {
    public: false,
    fileSizeLimit: MAX_IMPORT_FILE_SIZE,
    allowedMimeTypes: ["text/csv", "text/plain"],
  });
  if (error) {
    throw new Error(`Falha ao proteger bucket de importação: ${error.message}`);
  }
}

export async function ensurePrivateEmailImportBucket(): Promise<void> {
  if (!ensureBucketPromise) {
    ensureBucketPromise = configurePrivateBucket().catch((error) => {
      ensureBucketPromise = null;
      throw error;
    });
  }
  await ensureBucketPromise;
}

export async function uploadEmailImportCsv(
  path: string,
  csv: string
): Promise<string> {
  await ensurePrivateEmailImportBucket();
  const admin = createAdminClient();
  const storage = admin.storage.from(EMAIL_IMPORT_BUCKET);
  const { error: uploadError } = await storage.upload(
    path,
    Buffer.from(csv, "utf8"),
    {
      contentType: "text/csv; charset=utf-8",
      upsert: true,
    }
  );
  if (uploadError) {
    throw new Error(`Falha ao subir CSV pro storage: ${uploadError.message}`);
  }

  const { data, error: signedUrlError } = await storage.createSignedUrl(
    path,
    SIGNED_URL_TTL_SECONDS
  );
  if (signedUrlError || !data?.signedUrl) {
    await storage.remove([path]).catch(() => {});
    throw new Error(
      `Falha ao assinar URL do CSV: ${
        signedUrlError?.message || "URL não retornada"
      }`
    );
  }
  return data.signedUrl;
}
