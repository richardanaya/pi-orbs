import React from "react";
import { Composition } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { Peek, PEEK_DURATION, PEEK_FPS, PEEK_SIZE } from "./Peek";
import { Release030 } from "./Release030";
import { DURATION, FPS, HEIGHT, WIDTH } from "./theme";

loadFont("normal", { weights: ["400", "600"], subsets: ["latin"] });
loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] });

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PiOrbs030"
        component={Release030}
        durationInFrames={DURATION}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="PiOrbsPeek"
        component={Peek}
        durationInFrames={PEEK_DURATION}
        fps={PEEK_FPS}
        width={PEEK_SIZE}
        height={PEEK_SIZE}
        defaultProps={{ background: "#ffffff", shadow: true }}
      />
      <Composition
        id="PiOrbsPeekBlack"
        component={Peek}
        durationInFrames={PEEK_DURATION}
        fps={PEEK_FPS}
        width={PEEK_SIZE}
        height={PEEK_SIZE}
        defaultProps={{ background: "#000000", shadow: false }}
      />
    </>
  );
};
