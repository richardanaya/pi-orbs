import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { PiFace } from "./PiFace";

/** Square social clip. 1080×1080, 30 fps, 7.0s. Start and end are empty. */
export const PEEK_FPS = 30;
export const PEEK_SIZE = 1080;
export const PEEK_DURATION = 210;

const FACE = 780;
/** Fully below the frame, including the drop shadow. */
const HIDDEN = 96;
/** How much of the orb sits above the bottom edge while it peeks. */
const SHOWN = -Math.round(FACE * 0.78);

const ENTER_START = 6;
const ENTER_END = 46;
const EXIT_START = 150;
const EXIT_END = 196;
const HOP_START = 112;

const SPLINE = Easing.bezier(0.45, 0, 0.2, 1);

/** Product blink: scaleY eases to 0.12 and back. One clear blink. */
function blinkScaleY(frame: number, center: number, half = 6): number {
  const distance = Math.abs(frame - center);
  if (distance >= half) return 1;
  const shut = 0.5 + 0.5 * Math.cos((distance / half) * Math.PI);
  return 1 - shut * 0.88;
}

/**
 * Same hop shape as website/pi-face.js (dip, lift, settle), eased so it
 * does not step between keys. Returns pixels; negative is up.
 */
function hopLift(frame: number, fps: number, size: number): number {
  const span = Math.round(fps * 0.56);
  const local = frame - HOP_START;
  if (local < 0 || local > span) return 0;
  const dip = Math.max(1, Math.round(span * 0.2));
  const peak = Math.max(dip + 1, Math.round(span * 0.46));
  return interpolate(local, [0, dip, peak, span], [0, size * 0.012, -size * 0.062, 0], {
    easing: SPLINE,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

type PeekProps = {
  /** Loop color. First and last frames are this empty field. */
  background?: string;
  /** Product drop shadow. Off when the field is black. */
  shadow?: boolean;
};

/**
 * The locked silver π-face peeks up from the bottom, glances, blinks,
 * hops once, then slides fully back out. Loop matches on an empty frame.
 */
export const Peek: React.FC<PeekProps> = ({ background = "#ffffff", shadow = true }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enterY = interpolate(frame, [ENTER_START, ENTER_END], [HIDDEN, SHOWN], {
    easing: Easing.out(Easing.back(1.25)),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exitY = interpolate(frame, [EXIT_START, EXIT_END], [SHOWN, HIDDEN], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = (frame < EXIT_START ? enterY : exitY) + hopLift(frame, fps, FACE);

  const glance = interpolate(frame, [50, 70, 104, 118, 134, 148], [0, -4.2, -4.2, 0, 2.2, 0], {
    easing: SPLINE,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const blush = interpolate(frame, [ENTER_END, 86, HOP_START + 8, EXIT_START], [0.8, 0.92, 1, 0.84], {
    easing: Easing.inOut(Easing.sin),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: FACE,
          height: FACE,
          left: (PEEK_SIZE - FACE) / 2,
          top: PEEK_SIZE,
          transform: `translateY(${y}px)`,
        }}
      >
        <PiFace
          size={FACE}
          look="silver"
          seed={4}
          glanceX={glance}
          eyesScale={blinkScaleY(frame, 86)}
          blushAmount={blush}
          shadow={shadow}
        />
      </div>
    </AbsoluteFill>
  );
};
