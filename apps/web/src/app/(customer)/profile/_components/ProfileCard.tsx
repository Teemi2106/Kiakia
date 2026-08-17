// app/(customer)/profile/_components/ProfileCard.tsx
"use client";

import { Camera, User, Star } from "lucide-react";
import Image from "next/image";

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

  if (isMobile) {
    return (
      <div className="flex flex-col items-center gap-4 pb-4">
        {/* Avatar */}
        <div className="relative">
          <div className="relative h-24 w-24 overflow-hidden rounded-full border-4 border-white shadow-sm">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={fullName}
                fill
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[#F0EDED]">
                <User className="size-10 text-[#5B403C]" />
              </div>
            )}
          </div>
          <button
            className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-white backdrop-blur-sm hover:bg-black/70"
            aria-label="Change photo"
          >
            <Camera className="size-4" />
          </button>
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
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-[#E5E2E1] bg-white p-6 shadow-sm">
      {/* Avatar */}
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full">
        {avatarUrl ? (
          <Image src={avatarUrl} alt={fullName} fill className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#F0EDED]">
            <User className="size-8 text-[#5B403C]" />
          </div>
        )}
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
      </div>
    </div>
  );
}
