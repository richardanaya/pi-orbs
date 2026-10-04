import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { PiFace } from "./PiFace";
import { fade, rise } from "./motion";
import {
  BRAND_IN,
  BRAND_OUT,
  COLORS,
  CTA_IN,
  DURATION,
  FONT,
  HERO_FILE,
  HERO_FRAMES,
  HERO_TRIM_AFTER,
  HERO_TRIM_BEFORE,
  MONO,
  PRODUCT_IN,
  TAG_IN,
  TAG_OUT,
  TITLE_IN,
  TITLE_OUT,
  type Look,
} from "./theme";

const PRODUCT_CAPTIONS = [
  { at: 12, text: "Sprites API token", detail: "No sprite CLI." },
  { at: 92, text: "Optional voice", detail: "Grok or OpenAI. Three tools." },
  { at: 172, text: "Scheduled messages", detail: "cron-job.org, optional." },
  { at: 252, text: "MCP event webhooks", detail: "A signed URL. A POST. A message." },
] as const;

const BRAND_FACES: { look: Look; seed: number }[] = [
  { look: "mist", seed: 11 },
  { look: "silver", seed: 12 },
  { look: "tide", seed: 13 },
  { look: "pine", seed: 14 },
  { look: "amber", seed: 15 },
  { look: "clay", seed: 16 },
  { look: "plum", seed: 17 },
];

const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = fade(frame, TITLE_IN, TITLE_IN + 16, TITLE_OUT - 18, TITLE_OUT);
  const enter = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 90, mass: 0.85 },
  });
  const titleY = rise(frame, 8, 36, 22);
  const version = fade(frame, 28, 48, TAG_IN - 8, TAG_IN + 10);
  const line = fade(frame, TAG_IN, TAG_IN + 16, TAG_OUT - 16, TAG_OUT);

  return (
    <AbsoluteFill
      style={{
        opacity,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          transform: `translateY(${(1 - enter) * 28}px) scale(${0.92 + enter * 0.08})`,
        }}
      >
        <PiFace size={220} look="silver" seed={3} hopAt={84} />
        <div
          style={{
            marginTop: 28,
            fontSize: 92,
            fontWeight: 600,
            letterSpacing: "-0.05em",
            lineHeight: 0.96,
            color: COLORS.text,
            transform: `translateY(${titleY}px)`,
          }}
        >
          Pi Orbs
        </div>
        <div style={{ position: "relative", marginTop: 20, minHeight: 44, width: 820 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              textAlign: "center",
              fontFamily: MONO,
              fontSize: 22,
              letterSpacing: "0.14em",
              color: COLORS.text,
              opacity: version,
            }}
          >
            0.3
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              textAlign: "center",
              fontSize: 26,
              lineHeight: 1.4,
              color: COLORS.muted,
              opacity: line,
            }}
          >
            Named Pi bots on one shared Fly.io Sprite
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ProductShot: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = fade(frame, 0, 16, HERO_FRAMES - 16, HERO_FRAMES);

  return (
    <AbsoluteFill style={{ opacity, background: COLORS.bg }}>
      <OffthreadVideo
        src={staticFile(HERO_FILE)}
        trimBefore={HERO_TRIM_BEFORE}
        trimAfter={HERO_TRIM_AFTER}
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
      {PRODUCT_CAPTIONS.map((caption) => {
        const local = fade(frame, caption.at, caption.at + 12, caption.at + 68, caption.at + 80);
        return (
          <div
            key={caption.text}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 64,
              display: "flex",
              justifyContent: "center",
              opacity: local,
            }}
          >
            <div
              style={{
                padding: "16px 28px 18px",
                borderRadius: 18,
                border: `1px solid ${COLORS.line}`,
                background: "rgba(0, 0, 0, 0.72)",
                boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
                textAlign: "center",
                minWidth: 360,
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em", color: COLORS.text }}>
                {caption.text}
              </div>
              <div style={{ marginTop: 6, fontSize: 18, color: COLORS.muted }}>{caption.detail}</div>
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const BrandBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = fade(frame, BRAND_IN, BRAND_IN + 16, BRAND_OUT - 18, BRAND_OUT);
  const y = rise(frame, BRAND_IN, BRAND_IN + 22, 20);

  return (
    <AbsoluteFill style={{ opacity, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          transform: `translateY(${y}px)`,
        }}
      >
        <div style={{ display: "flex", gap: 22, alignItems: "center" }}>
          {BRAND_FACES.map((face, i) => {
            const appear = fade(frame, BRAND_IN + 6 + i * 4, BRAND_IN + 18 + i * 4, BRAND_OUT - 18, BRAND_OUT);
            return (
              <div key={face.look} style={{ opacity: appear }}>
                <PiFace size={128} look={face.look} seed={face.seed} />
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 36,
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: "-0.04em",
            color: COLORS.text,
          }}
        >
          Live π-face
        </div>
        <div style={{ marginTop: 12, fontSize: 22, color: COLORS.muted }}>
          Pastels, dark teal eyes, traced π, blush
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CallToAction: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = fade(frame, CTA_IN, CTA_IN + 16, DURATION - 20, DURATION);
  const enter = spring({
    frame: frame - CTA_IN,
    fps,
    config: { damping: 16, stiffness: 90, mass: 0.85 },
  });

  return (
    <AbsoluteFill style={{ opacity, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          transform: `translateY(${(1 - enter) * 24}px) scale(${0.96 + enter * 0.04})`,
        }}
      >
        <PiFace size={160} look="silver" seed={21} hopAt={CTA_IN + 36} />
        <div
          style={{
            marginTop: 28,
            fontSize: 64,
            fontWeight: 600,
            letterSpacing: "-0.05em",
            color: COLORS.text,
          }}
        >
          Pi Orbs
        </div>
        <div
          style={{
            marginTop: 28,
            display: "flex",
            alignItems: "center",
            width: 440,
            border: `1px solid ${COLORS.lineStrong}`,
            borderRadius: 999,
            padding: "10px 12px 10px 28px",
            background: COLORS.pill,
            boxShadow: "0 18px 50px rgba(0, 0, 0, 0.35)",
          }}
        >
          <div
            style={{
              flex: 1,
              fontFamily: MONO,
              fontSize: 22,
              color: COLORS.text,
            }}
          >
            npx pi-orbs
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 88,
              minHeight: 48,
              padding: "0 18px",
              borderRadius: 999,
              background: "#fff",
              color: "#0a0a0a",
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            Copy
          </div>
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: MONO,
            fontSize: 18,
            color: COLORS.muted,
          }}
        >
          piorbs.com
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Release030: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        backgroundImage:
          "radial-gradient(900px 480px at 50% -120px, rgba(255, 255, 255, 0.06), transparent 60%)",
        fontFamily: FONT,
        color: COLORS.text,
      }}
    >
      <TitleCard />
      <Sequence from={PRODUCT_IN} durationInFrames={HERO_FRAMES} name="Product" layout="none">
        <ProductShot />
      </Sequence>
      <BrandBeat />
      <CallToAction />
    </AbsoluteFill>
  );
};

export { DURATION };
