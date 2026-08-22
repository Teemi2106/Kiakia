// app/(vendor)/history/_components/HistoryPagination.tsx
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

interface HistoryPaginationProps {
  total: number;
  currentPage?: number;
  pageSize?: number;
}

export function HistoryPagination({
  total,
  currentPage = 1,
  pageSize = 10,
}: HistoryPaginationProps) {
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex items-center justify-between border-t border-[#E4BEB8] bg-[rgba(246,243,242,0.5)] px-6 py-4">
      <p className="text-sm text-[#5B403C]">
        Showing 1 to {Math.min(pageSize, total)} of {total} orders
      </p>
      <div className="flex gap-1">
        <button
          disabled={currentPage === 1}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#E4BEB8] bg-white disabled:opacity-50"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#B61913] text-sm font-medium text-white">
          1
        </button>
        <button className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#E4BEB8] bg-white text-sm font-medium text-[#1C1B1B] transition-colors hover:bg-[#F0EDED]">
          2
        </button>
        <button className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#E4BEB8] bg-white text-sm font-medium text-[#1C1B1B] transition-colors hover:bg-[#F0EDED]">
          3
        </button>
        <button
          disabled={currentPage === totalPages}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#E4BEB8] bg-white disabled:opacity-50"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
