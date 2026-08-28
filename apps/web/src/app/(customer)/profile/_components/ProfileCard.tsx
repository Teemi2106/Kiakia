// app/(customer)/profile/_components/ProfileCard.tsx
"use client";

import { Camera, User, Star, Loader2 } from "lucide-react";
import Image from "next/image";
import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { updateAvatarAction } from "@/app/actions/profile";

interface ProfileCardProps {
  fullName: string;
  email: string;
  phone?: string | null;
  memberSince?: string | null;
  avatarUrl?: string | null;
  role: string;
  variant?: "desktop" | "mobile";
}

export function ProfileCard({
  fullName,
  email,
  phone,
  memberSince,
  avatarUrl,
  role,
  variant = "desktop",
}: ProfileCardProps) {
  const isMobile = variant === "mobile";
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onPickPhoto() {
    fileInputRef.current?.click();
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);

    const formData = new FormData();
    formData.set("avatar", file);
    startTransition(async () => {
      const result = await updateAvatarAction(formData);
      URL.revokeObjectURL(objectUrl);
      setPreview(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function renderAvatar(iconSizeClass: string) {
    if (preview) {
      return <img src={preview} alt={fullName} className="absolute inset-0 h-full w-full object-cover" />;
    }
    if (avatarUrl) {
      return <Image src={avatarUrl} alt={fullName} fill className="object-cover" />;
    }
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#F0EDED]">
        <User className={`${iconSizeClass} text-[#5B403C]`} />
      </div>
    );
  }

  const avatarInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/avif"
      className="hidden"
      onChange={onFileChange}
    />
  );

  if (isMobile) {
    return (
      <div className="flex flex-col items-center gap-4 pb-4">
        {/* Avatar */}
        <div className="relative">
          <div className="relative h-24 w-24 overflow-hidden rounded-full border-4 border-white shadow-sm">
            {renderAvatar("size-10")}
          </div>
          <button
            type="button"
            onClick={onPickPhoto}
            disabled={isPending}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-white backdrop-blur-sm hover:bg-black/70 disabled:opacity-60"
            aria-label="Change photo"
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          </button>
          {avatarInput}
        </div>

        {/* Info */}
        <div className="flex flex-col items-center">
          <h2 className="font-sora text-[28px] font-bold leading-[34px] text-[#1C1B1B]">
            {fullName || "Add your name"}
          </h2>
          <p className="font-inter text-base text-[#5B403C]">{email}</p>
          {phone && (
            <p className="font-inter text-base text-[#5B403C]">{phone}</p>
          )}
          <div className="mt-3 flex items-center gap-2 rounded-full bg-[#F0EDED] px-3 py-1">
            <Star className="size-4 text-[#934B00]" />
            <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
              {role}
            </span>
          </div>
          {error && <p className="mt-2 font-inter text-xs font-medium text-[#BA1A1A]">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-[#E5E2E1] bg-white p-6 shadow-sm">
      {/* Avatar */}
      <div className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-full">
        {renderAvatar("size-8")}
        <button
          type="button"
          onClick={onPickPhoto}
          disabled={isPending}
          aria-label="Change photo"
          className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
        </button>
        {avatarInput}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col">
        <h3 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
          {fullName || "Add your name"}
        </h3>
        <p className="font-inter text-xs font-medium text-[#5B403C]">{email}</p>
        {memberSince && (
          <p className="font-inter text-xs text-[#5B403C]">
            Member since{" "}
            {new Date(memberSince).toLocaleDateString("en-NG", {
              month: "long",
              year: "numeric",
            })}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2 rounded-full bg-[#F0EDED] px-3 py-1 w-fit">
          <span className="h-2.5 w-2.5 rounded-full bg-[#934B00]" />
          <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
            {role}
          </span>
        </div>
        {error && <p className="mt-2 font-inter text-xs font-medium text-[#BA1A1A]">{error}</p>}
      </div>
    </div>
  );
}
