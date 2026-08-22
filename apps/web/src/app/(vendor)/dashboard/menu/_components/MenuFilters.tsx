// app/(vendor)/menu/_components/MenuFilters.tsx
"use client";

import { Search } from "lucide-react";

interface MenuFiltersProps {
  categories: string[];
  activeFilter: string;
  onFilterChange: (filter: string) => void;
  onSearch: (query: string) => void;
}

export function MenuFilters({
  categories,
  activeFilter,
  onFilterChange,
  onSearch,
}: MenuFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4">
      {/* Search */}
      <div className="relative flex-1 w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#5B403C]" />
        <input
          type="text"
          placeholder="Search menu items..."
          onChange={(e) => onSearch(e.target.value)}
          className="w-full rounded-xl bg-[#F0EDED] pl-10 pr-4 py-3 text-sm text-[#1C1B1B] placeholder:text-[#5B403C] focus:outline-none focus:ring-2 focus:ring-[#B61913]/20"
        />
      </div>

      {/* Filter Buttons */}
      <div className="flex gap-2 overflow-x-auto w-full sm:w-auto">
        <button
          onClick={() => onFilterChange("all")}
          className={`rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
            activeFilter === "all"
              ? "bg-[#B61913] text-white"
              : "bg-[#F0EDED] text-[#5B403C] hover:bg-[#E5E2E1]"
          }`}
        >
          All
        </button>
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => onFilterChange(category)}
            className={`rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              activeFilter === category
                ? "bg-[#B61913] text-white"
                : "bg-[#F0EDED] text-[#5B403C] hover:bg-[#E5E2E1]"
            }`}
          >
            {category}
          </button>
        ))}
      </div>
    </div>
  );
}
