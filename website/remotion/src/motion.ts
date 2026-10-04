import { Easing, interpolate } from "remotion";
import { COLORS, LOOKS, type Look } from "./theme";

const KEY_TIMES = [0, 0.06, 0.16, 0.48, 0.58, 0.64, 0.74, 0.92, 1];
const SPLINE = Easing.bezier(0.45, 0, 0.2, 1);

export function fade(
  frame: number,
  fadeIn: number,
  hold: number,
  fadeOut: number,
  gone: number,
): number {
  return interpolate(frame, [fadeIn, hold, fadeOut, gone], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export function rise(frame: number, start: number, end: number, from = 18): number {
  return interpolate(frame, [start, end], [from, 0], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

function unit(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function faceMotion(seed: number): {
  first: number;
  second: number;
  dur: number;
  begin: number;
  blink: number;
  blinkDelay: number;
  blush: number;
  blushDelay: number;
} {
  const span = (min: number, max: number, s: number) => min + unit(seed + s) * (max - min);
  const reach = span(4.2, 6.2, 1);
  const first = unit(seed + 2) < 0.5 ? -reach : reach;
  const second = -first * span(0.72, 1, 3);
  return {
    first,
    second,
    dur: span(7.5, 12, 4),
    begin: span(0, 2.4, 5),
    blink: span(4.2, 7.4, 6),
    blinkDelay: span(0, 2.8, 7),
    blush: span(3.2, 5.8, 8),
    blushDelay: span(0, 2.2, 9),
  };
}

function keyed(progress: number, values: number[]): number {
  const p = Math.min(1, Math.max(0, progress));
  for (let i = 0; i < KEY_TIMES.length - 1; i++) {
    if (p <= KEY_TIMES[i + 1]) {
      const t = (p - KEY_TIMES[i]) / (KEY_TIMES[i + 1] - KEY_TIMES[i]);
      const a = values[i];
      const b = values[i + 1];
      return a + (b - a) * SPLINE(t);
    }
  }
  return values[values.length - 1];
}

export function lookSlide(progress: number, first: number, second: number): { x: number; y: number; scale: number } {
  const x = keyed(progress, [0, 0, first, first, 0, 0, second, second, 0]);
  const y = -Math.min(1.15, (x * x) / 28);
  const scale = 1 - Math.min(0.12, Math.abs(x) / 55);
  return { x, y, scale };
}

export function blinkScale(frame: number, fps: number, cycle: number, delay: number): number {
  const t = frame / fps - delay;
  if (t < 0) return 1;
  const p = (t / cycle) % 1;
  const near = Math.min(Math.abs(p - 0.48), Math.abs(p - 0.94));
  if (near >= 0.018) return 1;
  return interpolate(near, [0, 0.018], [0.12, 1], { extrapolateRight: "clamp" });
}

export function blushOpacity(frame: number, fps: number, cycle: number, delay: number): number {
  const t = frame / fps - delay;
  if (t < 0) return 0.8;
  return 0.8 + 0.2 * (0.5 + 0.5 * Math.sin((t / cycle) * Math.PI * 2));
}

/** Rare hop from website/pi-face.js orb-hop (squash, lift, settle). */
export function hopY(frame: number, hopAt: number | undefined, fps: number): number {
  if (hopAt === undefined) return 0;
  const span = Math.round(fps * 0.48);
  const local = frame - hopAt;
  if (local < 0 || local > span) return 0;
  return interpolate(local, [0, 0.22 * span, 0.5 * span, span], [0, 0.015, -0.06, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export function orbColor(look?: Look, tone?: 0 | 1 | 2): string {
  if (look) return LOOKS[look];
  if (tone === 0) return "#d5e2ea";
  if (tone === 1) return "#e7ddd2";
  if (tone === 2) return "#dce8df";
  return "#d7e0e6";
}

export function orbBackground(orb: string): string {
  return [
    `radial-gradient(circle at 92% 96%, color-mix(in srgb, ${orb} 42%, #4a5559) 0%, color-mix(in srgb, ${orb} 74%, #8b9598) 28%, transparent 52%)`,
    `radial-gradient(circle at 32% 26%, color-mix(in srgb, ${orb} 10%, white) 0%, transparent 42%)`,
    orb,
  ].join(", ");
}

export { COLORS };
