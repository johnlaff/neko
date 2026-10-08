import { useEffect, useState } from "react";
import miaEnsinando from "./assets/mascots/mia-ensinando.webp";
import nekoComemorando from "./assets/mascots/neko-comemorando.webp";
import nekoComemorandoViva from "./assets/mascots/neko-comemorando-viva.webp";
import nekoDormindo from "./assets/mascots/neko-dormindo.webp";
import nekoProcurando from "./assets/mascots/neko-procurando.webp";
import nekoSatisfeito from "./assets/mascots/neko-satisfeito.webp";

export type Pose = "searching" | "sleeping" | "celebrating" | "content" | "miaTeaching";

/**
 * Neko (the brown tabby) and Mia (the cream one with glasses), drawn from the owner's two cats.
 * Each pose is a transparent WebP at most 480px on its longest side; `w`/`h` keep the box from
 * jumping while it loads. A pose with `alive` plays that loop over the still (see LivingCat).
 * Decorative: whatever sits next to the cat says the same in words.
 */
const POSES: Record<Pose, { src: string; w: number; h: number; alive?: string }> = {
  searching: { src: nekoProcurando, w: 464, h: 480 },
  sleeping: { src: nekoDormindo, w: 480, h: 318 },
  // A win is rare, so the cat that marks it waves its paws instead of standing still.
  celebrating: { src: nekoComemorando, w: 330, h: 480, alive: nekoComemorandoViva },
  content: { src: nekoSatisfeito, w: 286, h: 480 },
  miaTeaching: { src: miaEnsinando, w: 357, h: 480 },
};

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
  const width = Math.round((p.w * height) / p.h);
  if (p.alive)
    return (
      <LivingCat
        still={p.src}
        alive={p.alive}
        width={width}
        height={height}
        className={className}
      />
    );
  return (
    <img
      className={className ? `mascot ${className}` : "mascot"}
      src={p.src}
      width={width}
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
  className?: string | undefined;
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
