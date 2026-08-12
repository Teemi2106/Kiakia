// components/BackButton.tsx
"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function BackButton() {
  const router = useRouter();

  const handleGoBack = () => {
    router.back(); // Goes to the previous page
    // OR router.push('/somewhere') if you want to go to a specific page
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
