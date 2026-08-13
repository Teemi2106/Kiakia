// app/(customer)/vendors/[slug]/_components/CategoryNav.tsx
"use client";

import { cn } from "@kiakia/ui";
import { useState, useEffect } from "react";

interface CategoryNavProps {
  categories: readonly { id: string; name: string }[]; // Add readonly
}

export function CategoryNav({ categories }: CategoryNavProps) {
  const [activeId, setActiveId] = useState<string>(categories[0]?.id || "");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id.replace("category-", ""));
            break;
          }
        }
      },
      { rootMargin: "-100px 0px -50% 0px", threshold: 0 },
    );

    const sections = document.querySelectorAll("[id^='category-']");
    sections.forEach((section) => observer.observe(section));

    return () => {
      sections.forEach((section) => observer.unobserve(section));
    };
  }, [categories]);

  const handleClick = (id: string) => {
    setActiveId(id);
    const element = document.getElementById(`category-${id}`);
    if (element) {
      const offset = 100;
      const top =
        element.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  if (categories.length === 0) return null;

  return (
    <div className="sticky top-[56px] z-30 bg-[rgba(252,249,248,0.95)] backdrop-blur-sm sm:top-[63px]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex gap-4 overflow-x-auto border-b border-[#E5E2E1] py-3 sm:gap-6 [-webkit-overflow-scrolling:touch]">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => handleClick(category.id)}
              className={cn(
                "whitespace-nowrap font-inter text-sm font-semibold transition-colors",
                activeId === category.id
                  ? "border-b-2 border-[#B61913] text-[#B61913]"
                  : "text-[#5B403C] hover:text-[#1C1B1B]",
              )}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
