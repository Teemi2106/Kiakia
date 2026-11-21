"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "./DoorHangerCta.module.css";

const LOCKED_MESSAGE = "Not just yet. We're getting ready!";

type DoorMotion = {
  angle: number;
  angularVelocity: number;
  pointerAngle: number;
  reducedMotion: boolean;
  lastScrollY: number;
  lastScrollAt: number;
  attemptStartedAt: number;
  lockClickPlayed: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type LockClickAudio = {
  context: AudioContext;
  buffer: AudioBuffer;
};

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
    // The visual interaction still works when audio is unavailable.
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
    volume.gain.setValueAtTime(0.035, clickAt);
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

export function DoorHangerCta() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const hangerRef = useRef<HTMLSpanElement>(null);
  const leverRef = useRef<HTMLSpanElement>(null);
  const leverButtonRef = useRef<HTMLButtonElement>(null);
  const lockClickAudioRef = useRef<LockClickAudio | null>(null);
  const attemptActiveRef = useRef(false);
  const frameRequestRef = useRef<(() => void) | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const motionRef = useRef<DoorMotion>({
    angle: 0,
    angularVelocity: 0,
    pointerAngle: 0,
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
    const hanger = hangerRef.current;
    const lever = leverRef.current;
    const leverButton = leverButtonRef.current;
    if (!scene || !hanger || !lever || !leverButton) return;

    lockClickAudioRef.current = createLockClickAudio();
    const motion = motionRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    motion.reducedMotion = reducedMotion.matches;
    motion.lastScrollY = window.scrollY;
    motion.lastScrollAt = performance.now();
    let frame = 0;
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

    const animate = (time: number) => {
      frame = 0;
      const delta = Math.min((time - lastFrameAt) / 16.67, 2);
      lastFrameAt = time;

      if (!motion.reducedMotion) {
        const idleSway = Math.sin(time * 0.00115) * 0.24;
        const targetAngle = idleSway + motion.pointerAngle;
        motion.angularVelocity += (targetAngle - motion.angle) * 0.04 * delta;
        motion.angularVelocity *= Math.pow(0.92, delta);
      } else {
        motion.angularVelocity *= Math.pow(0.82, delta);
      }

      motion.angle = clamp(motion.angle + motion.angularVelocity * delta, -15, 15);
      hanger.style.transform = `rotate(${motion.angle.toFixed(2)}deg)`;

      let leverAngle = 0;
      if (attemptActiveRef.current) {
        const elapsed = time - motion.attemptStartedAt;
        const pressDuration = motion.reducedMotion ? 110 : 155;
        const maxLeverAngle = motion.reducedMotion ? 7 : 14;

        if (elapsed <= pressDuration) {
          const pressEase = 1 - Math.exp(-elapsed / (motion.reducedMotion ? 42 : 54));
          leverAngle = maxLeverAngle * pressEase;
        } else {
          const releaseTime = elapsed - pressDuration;
          const spring = Math.exp(-releaseTime / (motion.reducedMotion ? 105 : 150));
          const bounce = Math.cos(releaseTime / (motion.reducedMotion ? 43 : 48));
          const vibration = (motion.reducedMotion ? 0.3 : 0.8)
            * Math.sin(releaseTime / 7)
            * Math.exp(-releaseTime / 45);
          leverAngle = maxLeverAngle * spring * bounce + vibration;
        }

        if (elapsed >= pressDuration && !motion.lockClickPlayed) {
          motion.lockClickPlayed = true;
          showLockedMessage();
        }

        if (elapsed >= (motion.reducedMotion ? 500 : 720)) {
          attemptActiveRef.current = false;
          motion.attemptStartedAt = 0;
          leverAngle = 0;
          if (motion.reducedMotion) {
            motion.angle = 0;
            motion.angularVelocity = 0;
            hanger.style.transform = "none";
          }
          setIsAttempting(false);
        }
      }

      lever.style.transform = `rotate(${leverAngle.toFixed(2)}deg)`;

      if (!motion.reducedMotion || attemptActiveRef.current) {
        frame = window.requestAnimationFrame(animate);
      }
    };

    const requestFrame = () => {
      if (frame || (motion.reducedMotion && !attemptActiveRef.current)) return;
      lastFrameAt = performance.now();
      frame = window.requestAnimationFrame(animate);
    };

    frameRequestRef.current = requestFrame;

    const onScroll = () => {
      const now = performance.now();
      const currentY = window.scrollY;
      const elapsed = Math.max(now - motion.lastScrollAt, 8);
      const velocity = (currentY - motion.lastScrollY) / elapsed;
      motion.lastScrollY = currentY;
      motion.lastScrollAt = now;

      if (!motion.reducedMotion) {
        // Downward scroll pushes the hanging sign back; upward scroll pushes it forward.
        motion.angularVelocity += clamp(-velocity * 0.52, -4.5, 4.5);
        requestFrame();
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (motion.reducedMotion || event.pointerType === "touch") return;
      const bounds = leverButton.getBoundingClientRect();
      const position = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
      motion.pointerAngle = (position - 0.5) * 1.15;
      requestFrame();
    };

    const onPointerLeave = () => {
      motion.pointerAngle = 0;
      requestFrame();
    };

    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      motion.reducedMotion = event.matches;
      if (event.matches && !attemptActiveRef.current) {
        motion.angle = 0;
        motion.angularVelocity = 0;
        motion.pointerAngle = 0;
        hanger.style.transform = "none";
      } else {
        requestFrame();
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    leverButton.addEventListener("pointermove", onPointerMove, { passive: true });
    leverButton.addEventListener("pointerleave", onPointerLeave);
    reducedMotion.addEventListener("change", onMotionPreferenceChange);
    requestFrame();

    return () => {
      window.removeEventListener("scroll", onScroll);
      leverButton.removeEventListener("pointermove", onPointerMove);
      leverButton.removeEventListener("pointerleave", onPointerLeave);
      reducedMotion.removeEventListener("change", onMotionPreferenceChange);
      frameRequestRef.current = null;
      if (frame) window.cancelAnimationFrame(frame);
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      if (lockClickAudioRef.current?.context.state !== "closed") {
        void lockClickAudioRef.current?.context.close().catch(() => undefined);
      }
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
    motion.attemptStartedAt = performance.now();
    motion.lockClickPlayed = false;
    motion.angularVelocity += motion.reducedMotion ? -2.2 : -7;
    setIsAttempting(true);
    setShowFeedback(false);
    playLockClick(lockClickAudioRef.current, motion.reducedMotion ? 110 : 155);
    frameRequestRef.current?.();
  };

  return (
    <div ref={sceneRef} className={styles.scene}>
      <Image
        className={styles.rosette}
        src="/assets/door-handle-rosette.png"
        alt=""
        width={1536}
        height={1024}
        sizes="(max-width: 379px) 68px, (max-width: 639px) 78px, (max-width: 1023px) 102px, 132px"
      />

      <span ref={hangerRef} className={styles.hanger}>
        <Image
          className={styles.hangerImage}
          src="/assets/restaurant-door-hanger.png"
          alt=""
          width={887}
          height={1774}
          sizes="(max-width: 379px) 68px, (max-width: 639px) 78px, (max-width: 1023px) 108px, (max-width: 1199px) 124px, 142px"
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
      >
        <span ref={leverRef} className={styles.leverMotion}>
          <Image
            className={styles.leverImage}
            src="/assets/door-handle-lever.png"
            alt=""
            width={2172}
            height={724}
            sizes="(max-width: 379px) 96px, (max-width: 639px) 112px, (max-width: 1023px) 140px, 195px"
          />
        </span>
      </button>

      <span
        id="door-hanger-feedback"
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
