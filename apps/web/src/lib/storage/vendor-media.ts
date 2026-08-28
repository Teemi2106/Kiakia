import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "vendor-media";
const MAX_BYTES = 5 * 1024 * 1024; // 5MiB — matches the bucket's own file_size_limit (0036)
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
};

/**
 * Uploads a vendor-owned image (menu item photo, store banner) to the
 * public `vendor-media` bucket under `{vendorId}/{pathPrefix}/{uuid}.{ext}`,
 * and returns its public URL. Always writes a fresh, randomly-named object
 * rather than overwriting a deterministic path — simpler than diffing
 * old/new extensions, at the cost of an orphaned object in storage per
 * replaced image (no cleanup job exists for this yet).
 *
 * Callers must already have proven the caller staffs `vendorId` — this
 * function does no authorization of its own, same as `createAdminClient()`
 * itself.
 */
export type UploadVendorImageResult = { ok: true; url: string } | { ok: false; error: string };

export async function uploadVendorImage(vendorId: string, pathPrefix: string, file: File): Promise<UploadVendorImageResult> {
  const ext = EXTENSION_BY_MIME[file.type];
  if (!ext) {
    return { ok: false, error: "Please upload a PNG, JPEG, WebP, or AVIF image." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image must be smaller than 5MB." };
  }

  const objectPath = `${vendorId}/${pathPrefix}/${crypto.randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const { error } = await admin.storage.from(BUCKET).upload(objectPath, file, {
    contentType: file.type,
  });

  if (error) {
    return { ok: false, error: "Could not upload image. Please try again." };
  }

  const { data } = admin.storage.from(BUCKET).getPublicUrl(objectPath);
  return { ok: true, url: data.publicUrl };
}
