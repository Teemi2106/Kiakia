"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import styles from "./DoorHangerCta.module.css";

export function DoorHangerCta() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hangerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const hanger = hangerRef.current;
    if (!wrapper || !hanger) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let isReduced = reducedMotion.matches;
    let frame = 0;
    let lastTime = performance.now();
    let lastScrollY = window.scrollY;
    let angle = 0;
    let angularVelocity = 0;
    let pointerAngle = 0;

    const tick = (time: number) => {
      frame = 0;
      if (isReduced) return;

      const delta = Math.min((time - lastTime) / 16.67, 2);
      lastTime = time;

      const idleAngle = Math.sin(time * 0.0011) * 0.42;
      const targetAngle = idleAngle + pointerAngle;
      angularVelocity += (targetAngle - angle) * 0.045 * delta;
      angularVelocity *= Math.pow(0.84, delta);
      angle += angularVelocity * delta;
      hanger.style.transform = `rotate(${angle.toFixed(2)}deg)`;
      frame = requestAnimationFrame(tick);
    };

    const startMotion = () => {
      if (isReduced || frame) return;
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
    };

    const onScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollDelta = currentScrollY - lastScrollY;
      lastScrollY = currentScrollY;
      angularVelocity += Math.max(-1.6, Math.min(1.6, -scrollDelta * 0.018));
      startMotion();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const bounds = wrapper.getBoundingClientRect();
      const position = (event.clientX - bounds.left) / bounds.width;
      const centerDistance = Math.min(Math.abs(position - 0.5) * 2, 1);
      pointerAngle = (position - 0.5) * (1 - centerDistance * 0.45) * 1.1;
      startMotion();
    };

    const onPointerLeave = () => {
      pointerAngle = 0;
      startMotion();
    };

    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      isReduced = event.matches;
      if (isReduced) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        angle = 0;
        angularVelocity = 0;
        pointerAngle = 0;
        hanger.style.transform = "none";
      } else {
        startMotion();
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    wrapper.addEventListener("pointermove", onPointerMove, { passive: true });
    wrapper.addEventListener("pointerleave", onPointerLeave);
    reducedMotion.addEventListener("change", onMotionPreferenceChange);
    startMotion();

    return () => {
      window.removeEventListener("scroll", onScroll);
      wrapper.removeEventListener("pointermove", onPointerMove);
      wrapper.removeEventListener("pointerleave", onPointerLeave);
      reducedMotion.removeEventListener("change", onMotionPreferenceChange);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={styles.wrapper}
      role="img"
      aria-label="KiaKia is coming soon"
    >
      <Image
        className={styles.handle}
        src="/assets/door-hanger-brass-handle.png"
        alt=""
        width={2172}
        height={724}
        sizes="(max-width: 639px) 124px, 160px"
      />
      <span ref={hangerRef} className={styles.hanger}>
        <Image
          className={styles.hangerImage}
          src="/assets/restaurant-coming-soon-hanger.png"
          alt=""
          width={1024}
          height={1536}
          sizes="(max-width: 639px) 36px, 44px"
        />
        <span className={styles.message} aria-hidden="true">
          COMING
          <br />
          SOON
        </span>
      </span>
    </div>
  );
}
