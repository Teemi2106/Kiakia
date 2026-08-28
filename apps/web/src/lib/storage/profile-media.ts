import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "avatars";
const MAX_BYTES = 5 * 1024 * 1024; // 5MiB — matches the bucket's own file_size_limit (0046)
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
};

/**
 * Uploads a customer's profile picture to the public `avatars` bucket
 * under `{userId}/{uuid}.{ext}`, and returns its public URL. Always writes
 * a fresh, randomly-named object rather than overwriting a deterministic
 * path, same tradeoff as uploadVendorImage — an orphaned object per
 * replaced photo, no cleanup job yet.
 *
 * Callers must already have proven `userId` is the authenticated caller's
 * own id — this function does no authorization of its own, same as
 * `createAdminClient()` itself.
 */
export type UploadAvatarResult = { ok: true; url: string } | { ok: false; error: string };

export async function uploadAvatarImage(userId: string, file: File): Promise<UploadAvatarResult> {
  const ext = EXTENSION_BY_MIME[file.type];
  if (!ext) {
    return { ok: false, error: "Please upload a PNG, JPEG, WebP, or AVIF image." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image must be smaller than 5MB." };
  }

  const objectPath = `${userId}/${crypto.randomUUID()}.${ext}`;
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
