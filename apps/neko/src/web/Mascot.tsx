import miaEnsinando from "./assets/mascots/mia-ensinando.webp";
import miaPensando from "./assets/mascots/mia-pensando.webp";
import nekoComemorando from "./assets/mascots/neko-comemorando.webp";
import nekoDormindo from "./assets/mascots/neko-dormindo.webp";
import nekoSatisfeito from "./assets/mascots/neko-satisfeito.webp";
import nekoSentado from "./assets/mascots/neko-sentado.webp";

/**
 * Neko (the brown tabby) and Mia (the cream one with glasses), drawn from the owner's two cats.
 * Each pose is a transparent WebP at most 480px on its longest side; `w`/`h` keep the box from
 * jumping while it loads. Decorative: whatever sits next to the cat says the same in words.
 */
const POSES = {
  sitting: { src: nekoSentado, w: 288, h: 480 },
  sleeping: { src: nekoDormindo, w: 480, h: 318 },
  celebrating: { src: nekoComemorando, w: 330, h: 480 },
  content: { src: nekoSatisfeito, w: 286, h: 480 },
  miaThinking: { src: miaPensando, w: 298, h: 480 },
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
