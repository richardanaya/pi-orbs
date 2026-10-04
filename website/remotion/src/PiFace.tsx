import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import {
  blinkScale,
  blushOpacity,
  faceMotion,
  hopY,
  lookSlide,
  orbBackground,
  orbColor,
} from "./motion";
import { PI_MARK_PATH } from "./pi-mark";
import { COLORS, type Look } from "./theme";

type PiFaceProps = {
  size: number;
  look?: Look;
  tone?: 0 | 1 | 2;
  seed?: number;
  hopAt?: number;
  style?: React.CSSProperties;
};

/**
 * Frame-driven port of website/pi-face.js.
 * Same pastel orb, dark teal eyes, traced π, blush, look-slide, and rare hop.
 */
export const PiFace: React.FC<PiFaceProps> = ({
  size,
  look,
  tone,
  seed = 1,
  hopAt,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const motion = faceMotion(seed);
  const elapsed = Math.max(0, frame / fps - motion.begin);
  const progress = (elapsed % motion.dur) / motion.dur;
  const slide = lookSlide(progress, motion.first, motion.second);
  const eyes = blinkScale(frame, fps, motion.blink, motion.blinkDelay);
  const blush = blushOpacity(frame, fps, motion.blush, motion.blushDelay);
  const hop = hopY(frame, hopAt, fps);
  const orb = orbColor(look, tone);

  return (
    <div
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        background: orbBackground(orb),
        filter: `drop-shadow(0 ${size * 0.25}px ${size * 0.2}px rgba(40, 24, 22, 0.16))`,
        transform: `translateY(${hop * size}px)`,
        ...style,
      }}
    >
      <svg viewBox="0 0 40 40" width="100%" height="100%" overflow="visible" aria-hidden="true">
        <g className="pi-look" transform={`translate(${slide.x} ${slide.y})`}>
          <g className="pi-shell" transform="translate(20 17)">
            <g className="pi-depth" transform={`scale(${slide.scale})`}>
              <g transform="translate(-20 -17)">
                <g className="pi-blush" opacity={blush} style={{ transformOrigin: "20px 19.85px" }}>
                  <ellipse cx="7.35" cy="19.85" rx="2.45" ry="1.45" fill={COLORS.blush} />
                  <ellipse cx="32.65" cy="19.85" rx="2.45" ry="1.45" fill={COLORS.blush} />
                </g>
                <path className="pi-mark" d={PI_MARK_PATH} fill={COLORS.ink} />
                <g
                  className="pi-eyes"
                  style={{
                    transform: `scaleY(${eyes})`,
                    transformOrigin: "20px 15.5px",
                  }}
                >
                  <ellipse cx="9.4" cy="15.5" rx="2.05" ry="2.05" fill={COLORS.ink} />
                  <ellipse cx="30.6" cy="15.5" rx="2.05" ry="2.05" fill={COLORS.ink} />
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
};
