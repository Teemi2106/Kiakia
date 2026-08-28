// app/(marketing)/_components/Reveal.tsx
"use client";

import { cn } from "@kiakia/ui";
import { useEffect, useRef, useState } from "react";

interface RevealProps {
  children: React.ReactNode;
  /** Stagger, in ms, applied as the CSS transition-delay. */
  delay?: number;
  className?: string;
  /** How far into the viewport the element must come before it reveals. */
  rootMargin?: string;
}

/**
 * Fades a below-the-fold block up as it scrolls into view, once.
 *
 * The hidden state lives in CSS behind `[data-shown="false"]`, and the
 * server renders `data-shown="true"` — so the section is visible in the
 * initial HTML and only becomes animatable after this component mounts and
 * confirms it can observe. Nothing can strand a section invisible: no JS,
 * no IntersectionObserver, or a hydration error all leave it shown.
 *
 * Not used above the fold — the hero animates in from `.kk-enter`, pure CSS,
 * so first paint doesn't wait on hydration.
 */
export function Reveal({ children, delay = 0, className, rootMargin = "0px 0px -12% 0px" }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    // Anything already on screen at mount stays on screen — hiding it now
    // would flash content the visitor is looking at.
    if (node.getBoundingClientRect().top < window.innerHeight) return;

    setShown(false);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin, threshold: 0.05 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return (
    <div
      ref={ref}
      data-shown={shown}
      className={cn("kk-reveal", className)}
      style={delay ? ({ "--kk-delay": `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
