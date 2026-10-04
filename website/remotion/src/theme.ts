/**
 * Site chrome from website/styles.css, plus the 0.3 π-face palette
 * from website/pi-face.js.
 */

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION = 960;

export const COLORS = {
  bg: "#000000",
  text: "#f3f4f5",
  muted: "#8d959e",
  line: "rgba(255, 255, 255, 0.1)",
  lineStrong: "rgba(255, 255, 255, 0.16)",
  ink: "#07313a",
  blush: "#e4a8ae",
  pill: "#050505",
};

export const LOOKS = {
  slate: "#c5d0dc",
  silver: "#e7e2d6",
  mist: "#c5dff6",
  tide: "#b7e6de",
  pine: "#c6e8b4",
  amber: "#f6d59a",
  clay: "#f6c4b6",
  plum: "#e0c6ef",
} as const;

export type Look = keyof typeof LOOKS;

export const TONES = ["#d5e2ea", "#e7ddd2", "#dce8df"] as const;

export const FONT =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const MONO =
  '"JetBrains Mono", ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

/** Skip the 0.2 3D-orb open and the v0.2.0 end card in the site hero. */
export const HERO_FILE = "pi-orbs-site-hero.mp4";
export const HERO_TRIM_BEFORE = 72;
export const HERO_TRIM_AFTER = 414;
export const HERO_FRAMES = HERO_TRIM_AFTER - HERO_TRIM_BEFORE;

export const TITLE_IN = 0;
export const TITLE_OUT = 160;
export const TAG_IN = 128;
export const TAG_OUT = 220;
export const PRODUCT_IN = 200;
export const PRODUCT_OUT = PRODUCT_IN + HERO_FRAMES;
export const BRAND_IN = 528;
export const BRAND_OUT = 740;
export const CTA_IN = 710;

export const POSTER_FRAME = 90;
