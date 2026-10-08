import { useEffect, useState } from "react";
import miaEnsinando from "./assets/mascots/mia-ensinando.webp";
import nekoComemorando from "./assets/mascots/neko-comemorando.webp";
import nekoDormindo from "./assets/mascots/neko-dormindo.webp";
import nekoProcurando from "./assets/mascots/neko-procurando.webp";
import nekoSatisfeito from "./assets/mascots/neko-satisfeito.webp";

/**
 * Neko (the brown tabby) and Mia (the cream one with glasses), drawn from the owner's two cats.
 * Each pose is a transparent WebP at most 480px on its longest side; `w`/`h` keep the box from
 * jumping while it loads. Decorative: whatever sits next to the cat says the same in words.
 */
const POSES = {
  searching: { src: nekoProcurando, w: 464, h: 480 },
  sleeping: { src: nekoDormindo, w: 480, h: 318 },
  celebrating: { src: nekoComemorando, w: 330, h: 480 },
  content: { src: nekoSatisfeito, w: 286, h: 480 },
  miaTeaching: { src: miaEnsinando, w: 357, h: 480 },
} as const;

export type Pose = keyof typeof POSES;

export const Mascot = ({
  pose,
  height,
  className,
}: {
  pose: Pose;
  /** Rendered height in CSS pixels; the width follows the pose. */
  height: number;
  className?: string;
}) => {
  const p = POSES[pose];
  return (
    <img
      className={className ? `mascot ${className}` : "mascot"}
      src={p.src}
      width={Math.round((p.w * height) / p.h)}
      height={height}
      alt=""
      decoding="async"
      draggable={false}
    />
  );
};

/**
 * A short looping animation over its first frame: the small still paints first (it is often the
 * largest thing on screen), and the loop takes over once it has downloaded and decoded. Whoever
 * asked for less motion keeps the still.
 */
export const LivingCat = ({
  still,
  alive,
  width,
  height,
  className,
}: {
  still: string;
  alive: string;
  width: number;
  height: number;
  className?: string;
}) => {
  const [src, setSrc] = useState(still);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let current = true;
    const img = new Image();
    img.src = alive;
    img.decode().then(
      () => current && setSrc(alive),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [alive]);
  return (
    <img
      className={className ? `mascot ${className}` : "mascot"}
      src={src}
      width={width}
      height={height}
      alt=""
      decoding="async"
      draggable={false}
    />
  );
};
