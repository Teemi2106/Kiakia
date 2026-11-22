"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "./RestaurantSign.module.css";

const LOCKED_MESSAGE = "Not just yet. We're getting ready!";

type DoorMotion = {
  angle: number;
  angularVelocity: number;
  leverAngle: number;
  reducedMotion: boolean;
  lastScrollY: number;
  lastScrollAt: number;
  attemptStartedAt: number;
  lockClickPlayed: boolean;
};

type LockClickAudio = {
  context: AudioContext;
  buffer: AudioBuffer;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createLockClickAudio(): LockClickAudio | null {
  try {
    const context = new window.AudioContext();
    const sampleCount = Math.floor(context.sampleRate * 0.045);
    const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
    const samples = buffer.getChannelData(0);

    for (let i = 0; i < samples.length; i += 1) {
      const envelope = 1 - i / samples.length;
      samples[i] = (Math.random() * 2 - 1) * envelope * envelope;
    }

    return { context, buffer };
  } catch {
    return null;
  }
}

function playLockClick(audio: LockClickAudio | null, delayMs: number) {
  if (!audio || audio.context.state === "closed") return;

  try {
    const { context, buffer } = audio;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const volume = context.createGain();
    const clickAt = context.currentTime + delayMs / 1000;

    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1500, clickAt);
    filter.Q.setValueAtTime(0.85, clickAt);
    volume.gain.setValueAtTime(0.025, clickAt);
    volume.gain.exponentialRampToValueAtTime(0.0001, clickAt + 0.04);

    source.connect(filter);
    filter.connect(volume);
    volume.connect(context.destination);
    source.start(clickAt);
    source.stop(clickAt + 0.045);
    void context.resume().catch(() => undefined);
  } catch {
    // The visual interaction still works when audio is unavailable.
  }
}

export function RestaurantSign() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const plaqueRef = useRef<HTMLSpanElement>(null);
  const leverRef = useRef<HTMLSpanElement>(null);
  const leverButtonRef = useRef<HTMLButtonElement>(null);
  const cordSvgRef = useRef<SVGSVGElement>(null);
  const cordShadowRef = useRef<SVGPathElement>(null);
  const cordCoreRef = useRef<SVGPathElement>(null);
  const cordTwistRef = useRef<SVGPathElement>(null);
  const cordKnotRef = useRef<SVGEllipseElement>(null);
  const lockClickAudioRef = useRef<LockClickAudio | null>(null);
  const attemptActiveRef = useRef(false);
  const frameRef = useRef(0);
  const requestFrameRef = useRef<(() => void) | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const motionRef = useRef<DoorMotion>({
    angle: 0,
    angularVelocity: 0,
    leverAngle: 0,
    reducedMotion: false,
    lastScrollY: 0,
    lastScrollAt: 0,
    attemptStartedAt: 0,
    lockClickPlayed: false,
  });
  const [isAttempting, setIsAttempting] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  useEffect(() => {
    const scene = sceneRef.current;
    const plaque = plaqueRef.current;
    const lever = leverRef.current;
    const leverButton = leverButtonRef.current;
    const cordSvg = cordSvgRef.current;
    const cordShadow = cordShadowRef.current;
    const cordCore = cordCoreRef.current;
    const cordTwist = cordTwistRef.current;
    const cordKnot = cordKnotRef.current;

    if (!scene || !plaque || !lever || !leverButton || !cordSvg || !cordShadow || !cordCore || !cordTwist || !cordKnot) {
      return;
    }

    const motion = motionRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    motion.reducedMotion = reducedMotion.matches;
    motion.lastScrollY = window.scrollY;
    motion.lastScrollAt = performance.now();

    let lastFrameAt = performance.now();

    const showLockedMessage = () => {
      setShowFeedback(true);
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      feedbackTimerRef.current = window.setTimeout(() => {
        setShowFeedback(false);
        feedbackTimerRef.current = null;
      }, 2400);
    };

    const paintAssembly = () => {
      const sceneBounds = scene.getBoundingClientRect();
      const leverBounds = leverButton.getBoundingClientRect();
      const pivotX = leverBounds.left - sceneBounds.left + leverBounds.width * 0.875;
      const pivotY = leverBounds.top - sceneBounds.top + leverBounds.height * 0.5;
      const loopRadius = clamp(leverBounds.width * 0.09, 5, 10);
      const leverRadians = (motion.leverAngle * Math.PI) / 180;
      const anchorX = pivotX - loopRadius * Math.cos(leverRadians);
      const anchorY = pivotY + loopRadius * Math.sin(leverRadians);
      const ropeLength = scene.clientWidth < 130 ? 45 : scene.clientWidth < 150 ? 51 : 58;
      const angleRadians = (motion.angle * Math.PI) / 180;
      const plaqueWidth = plaque.offsetWidth;
      const plaqueHeight = plaque.offsetHeight;
      const holeOffset = plaqueHeight * 0.05;
      const endX = anchorX + ropeLength * Math.sin(angleRadians);
      const endY = anchorY + ropeLength * Math.cos(angleRadians);
      const deltaX = endX - anchorX;
      const deltaY = endY - anchorY;
      const softBow = 3 + Math.min(Math.abs(motion.angle) * 0.1, 1.5);
      const side = motion.angle < 0 ? -1 : 1;
      const curve = [
        `M ${anchorX.toFixed(2)} ${anchorY.toFixed(2)}`,
        `C ${(anchorX + deltaX * 0.32 + softBow * side).toFixed(2)} ${(anchorY + deltaY * 0.32).toFixed(2)}`,
        `${(endX - deltaX * 0.28 + softBow * side).toFixed(2)} ${(endY - deltaY * 0.28).toFixed(2)}`,
        `${endX.toFixed(2)} ${endY.toFixed(2)}`,
      ].join(" ");

      cordSvg.setAttribute("viewBox", `0 0 ${scene.clientWidth} ${cordSvg.clientHeight}`);
      cordShadow.setAttribute("d", curve);
      cordCore.setAttribute("d", curve);
      cordTwist.setAttribute("d", curve);
      cordKnot.setAttribute("cx", anchorX.toFixed(2));
      cordKnot.setAttribute("cy", anchorY.toFixed(2));

      plaque.style.left = `${anchorX - plaqueWidth / 2}px`;
      plaque.style.top = `${anchorY + ropeLength - holeOffset}px`;
      plaque.style.transform = `translate3d(${(ropeLength * Math.sin(angleRadians)).toFixed(2)}px, ${(ropeLength * (Math.cos(angleRadians) - 1)).toFixed(2)}px, 0) rotate(${motion.angle.toFixed(2)}deg)`;
    };

    const animate = (time: number) => {
      frameRef.current = 0;
      const delta = Math.min(Math.max((time - lastFrameAt) / 16.67, 0.5), 2);
      lastFrameAt = time;

      if (!motion.reducedMotion) {
        const idleAngle = Math.sin(time * 0.00105) * 0.38;
        motion.angularVelocity += (idleAngle - motion.angle) * 0.014 * delta;
        motion.angularVelocity *= Math.pow(0.945, delta);
      } else {
        motion.angularVelocity *= Math.pow(0.72, delta);
      }

      motion.angle = clamp(motion.angle + motion.angularVelocity * delta, -10, 10);

      let leverAngle = 0;
      if (attemptActiveRef.current) {
        const elapsed = time - motion.attemptStartedAt;
        const pressDuration = motion.reducedMotion ? 85 : 145;
        const maxLeverAngle = motion.reducedMotion ? 7 : 12;

        if (elapsed <= pressDuration) {
          leverAngle = maxLeverAngle * (1 - Math.exp(-elapsed / (motion.reducedMotion ? 38 : 52)));
        } else {
          const releaseTime = elapsed - pressDuration;
          const spring = Math.exp(-releaseTime / (motion.reducedMotion ? 76 : 132));
          const bounce = Math.cos(releaseTime / (motion.reducedMotion ? 32 : 42));
          const vibration = (motion.reducedMotion ? 0.16 : 0.55)
            * Math.sin(releaseTime / 8)
            * Math.exp(-releaseTime / 48);
          leverAngle = maxLeverAngle * spring * bounce + vibration;
        }

        if (elapsed >= pressDuration && !motion.lockClickPlayed) {
          motion.lockClickPlayed = true;
          showLockedMessage();
        }

        if (elapsed >= (motion.reducedMotion ? 400 : 700)) {
          attemptActiveRef.current = false;
          motion.attemptStartedAt = 0;
          leverAngle = 0;
          if (motion.reducedMotion) {
            motion.angle = 0;
            motion.angularVelocity = 0;
          }
          setIsAttempting(false);
        }
      }

      motion.leverAngle = leverAngle;
      lever.style.transform = `rotate(${-leverAngle.toFixed(2)}deg)`;
      paintAssembly();

      if (!motion.reducedMotion || attemptActiveRef.current) {
        frameRef.current = window.requestAnimationFrame(animate);
      }
    };

    const requestFrame = () => {
      if (frameRef.current || (motion.reducedMotion && !attemptActiveRef.current)) return;
      lastFrameAt = performance.now();
      frameRef.current = window.requestAnimationFrame(animate);
    };

    requestFrameRef.current = requestFrame;

    const onScroll = () => {
      const now = performance.now();
      const currentY = window.scrollY;
      const elapsed = Math.max(now - motion.lastScrollAt, 8);
      const velocity = (currentY - motion.lastScrollY) / elapsed;
      motion.lastScrollY = currentY;
      motion.lastScrollAt = now;

      if (!motion.reducedMotion) {
        motion.angularVelocity += clamp(-velocity * 0.18, -2, 2);
        requestFrame();
      }
    };

    const onResize = () => {
      paintAssembly();
      requestFrame();
    };

    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      motion.reducedMotion = event.matches;
      if (event.matches && !attemptActiveRef.current) {
        motion.angle = 0;
        motion.angularVelocity = 0;
        motion.leverAngle = 0;
        lever.style.transform = "none";
        paintAssembly();
      } else {
        requestFrame();
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    reducedMotion.addEventListener("change", onMotionPreferenceChange);
    paintAssembly();
    requestFrame();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      reducedMotion.removeEventListener("change", onMotionPreferenceChange);
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      if (lockClickAudioRef.current?.context.state !== "closed") {
        void lockClickAudioRef.current?.context.close().catch(() => undefined);
      }
      frameRef.current = 0;
      requestFrameRef.current = null;
      lockClickAudioRef.current = null;
    };
  }, []);

  const tryDoor = () => {
    if (attemptActiveRef.current) return;
    attemptActiveRef.current = true;
    const motion = motionRef.current;

    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }

    lockClickAudioRef.current ??= createLockClickAudio();
    motion.attemptStartedAt = performance.now();
    motion.lockClickPlayed = false;
    motion.angularVelocity += motion.reducedMotion ? -0.55 : -1.45;
    setIsAttempting(true);
    setShowFeedback(false);
    playLockClick(lockClickAudioRef.current, motion.reducedMotion ? 85 : 145);

    requestFrameRef.current?.();
  };

  return (
    <div ref={sceneRef} className={styles.scene}>
      <Image
        className={styles.rosette}
        src="/assets/door-handle-rosette-cutout.png"
        alt=""
        width={1254}
        height={1254}
        sizes="(max-width: 639px) 26px, (max-width: 1023px) 34px, 42px"
      />

      <svg
        ref={cordSvgRef}
        className={styles.cord}
        viewBox="0 0 160 288"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="restaurant-cord-tone" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#65472c" />
            <stop offset="0.48" stopColor="#c5a273" />
            <stop offset="1" stopColor="#795637" />
          </linearGradient>
        </defs>
        <path ref={cordShadowRef} className={styles.cordShadow} />
        <path ref={cordCoreRef} className={styles.cordCore} />
        <path ref={cordTwistRef} className={styles.cordTwist} />
        <ellipse ref={cordKnotRef} className={styles.cordKnot} rx="2.4" ry="1.8" />
      </svg>

      <span ref={plaqueRef} className={styles.plaqueMotion}>
        <Image
          className={styles.plaqueImage}
          src="/assets/restaurant-sign-plaque.png"
          alt=""
          width={1024}
          height={1536}
          sizes="(max-width: 359px) 76px, (max-width: 639px) 90px, (max-width: 1023px) 90px, 104px"
        />
        <span className={styles.message}>
          COMING
          <br />
          SOON
        </span>
      </span>

      <button
        ref={leverButtonRef}
        type="button"
        className={styles.leverButton}
        onClick={tryDoor}
        disabled={isAttempting}
        aria-label={isAttempting ? "Trying the locked KiaKia door" : "Try the KiaKia door handle"}
        aria-describedby="restaurant-sign-feedback"
      >
        <span ref={leverRef} className={styles.leverMotion}>
          <Image
            className={styles.leverImage}
            src="/assets/door-handle-lever-cutout.png"
            alt=""
            width={2172}
            height={724}
            sizes="(max-width: 639px) 68px, (max-width: 1023px) 94px, 116px"
          />
        </span>
      </button>

      <span
        id="restaurant-sign-feedback"
        className={`${styles.feedback} ${showFeedback ? styles.feedbackVisible : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {showFeedback ? LOCKED_MESSAGE : ""}
      </span>
    </div>
  );
}
