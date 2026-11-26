export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function countdownUntil(targetMs: number, nowMs: number): CountdownParts | null {
  const millisecondsRemaining = targetMs - nowMs;
  if (millisecondsRemaining <= 0) return null;
  const remainingSeconds = Math.ceil(millisecondsRemaining / 1000);

  return {
    days: Math.floor(remainingSeconds / 86_400),
    hours: Math.floor((remainingSeconds % 86_400) / 3_600),
    minutes: Math.floor((remainingSeconds % 3_600) / 60),
    seconds: remainingSeconds % 60,
  };
}
