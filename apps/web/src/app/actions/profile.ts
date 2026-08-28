"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadAvatarImage } from "@/lib/storage/profile-media";

export type UpdateAvatarResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Uploads the caller's own profile picture and points profiles.avatar_url
 * at it. Uses verifySession() + the admin client (not the RLS-guarded
 * client "update own profile" policy in 0007_rls.sql already allows a
 * self-update) because the storage write itself needs the admin client —
 * the `avatars` bucket has no client-writable storage.objects policy, see
 * 0046_customer_avatar_storage.sql — so both writes happen here together
 * rather than splitting the DB update off to a client-side call.
 */
export async function updateAvatarAction(formData: FormData): Promise<UpdateAvatarResult> {
  const session = await verifySession();

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose an image." };
  }

  const uploaded = await uploadAvatarImage(session.userId, file);
  if (!uploaded.ok) return uploaded;

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ avatar_url: uploaded.url }).eq("id", session.userId);
  if (error) {
    return { ok: false, error: "Could not save your photo. Please try again." };
  }

  revalidatePath("/profile");
  return { ok: true, url: uploaded.url };
}
