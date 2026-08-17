// components/BackButton.tsx
"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function BackButton() {
  const router = useRouter();

  const handleGoBack = () => {
    router.push("/"); // Goes to the previous page
  };

  return (
    <button
      onClick={handleGoBack}
      className="flex h-10 w-8 items-center justify-center rounded-full p-2 hover:bg-black/5"
      aria-label="Go back"
    >
      <ChevronLeft className="size-4 text-[#1C1B1B]" />
    </button>
  );
}
