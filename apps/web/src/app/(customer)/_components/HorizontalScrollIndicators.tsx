"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@kiakia/ui";

/** Small, tappable page markers for a horizontally scrolling rail. */
export function HorizontalScrollIndicators({
  targetId,
  className,
}: {
  targetId: string;
  className?: string;
}) {
  const [pageCount, setPageCount] = useState(0);
  const [activePage, setActivePage] = useState(0);
  const pageCountRef = useRef(0);

  useEffect(() => {
    const rail = document.getElementById(targetId);
    if (!(rail instanceof HTMLElement)) return;

    const measure = () => {
      if (rail.clientWidth === 0) {
        pageCountRef.current = 0;
        setPageCount(0);
        setActivePage(0);
        return;
      }
      const maxScroll = rail.scrollWidth - rail.clientWidth;
      const pages = maxScroll > 2 ? Math.ceil(rail.scrollWidth / rail.clientWidth) : 0;
      pageCountRef.current = pages;
      setPageCount(pages);
      setActivePage(pages > 1 ? Math.round((rail.scrollLeft / maxScroll) * (pages - 1)) : 0);
    };

    const onScroll = () => {
      const maxScroll = rail.scrollWidth - rail.clientWidth;
      const pages = pageCountRef.current;
      if (pages > 1 && maxScroll > 0) {
        setActivePage(Math.round((rail.scrollLeft / maxScroll) * (pages - 1)));
      }
    };

    measure();
    rail.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    window.addEventListener("resize", measure);
    return () => {
      rail.removeEventListener("scroll", onScroll);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [targetId]);

  if (pageCount < 2) return null;

  return (
    <div className={cn("mt-2 flex items-center justify-center gap-2", className)} role="group" aria-label="Carousel pages">
      {Array.from({ length: pageCount }, (_, index) => (
        <button
          key={index}
          type="button"
          aria-label={`Scroll to page ${index + 1} of ${pageCount}`}
          aria-pressed={activePage === index}
          onClick={() => {
            const rail = document.getElementById(targetId);
            if (!rail) return;
            const maxScroll = rail.scrollWidth - rail.clientWidth;
            rail.scrollTo({
              left: (index / (pageCount - 1)) * maxScroll,
              behavior: "smooth",
            });
          }}
          className={cn(
            "h-2 rounded-full transition-[width,background-color] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kk-red/40 focus-visible:ring-offset-2",
            activePage === index
              ? "w-5 bg-kk-red"
              : "w-2 bg-kk-line hover:bg-kk-cocoa/60",
          )}
        />
      ))}
    </div>
  );
}
