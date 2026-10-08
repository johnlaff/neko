import type { Win } from "@neko/engine";
import { useState } from "react";
import { winShareText, winText } from "../shared/wins.ts";
import { capitalize, monthName } from "./format.ts";

/**
 * A closed month's wins and a share button that turns them into a
 * picture (4:5, the size feeds and chats crop to). The picture carries the wins only, never an
 * amount: what is shared is the achievement, not the finances.
 */
export function Wins({
  wins,
  year,
  month,
  className,
}: {
  wins: readonly Win[];
  year: number;
  month: number;
  className?: string | undefined;
}) {
  if (wins.length === 0) return null;
  const title = `${capitalize(monthName(month))} de ${year}`;
  return (
    <div className={className ? `recap-wins ${className}` : "recap-wins"}>
      <ul aria-label="Conquistas do mês">
        {wins.map((w) => (
          <li key={w.kind}>{winText(w)}</li>
        ))}
      </ul>
      <ShareButton
        title={`${title} fechou`}
        lines={wins.map(winShareText)}
        label={`Compartilhar as conquistas de ${title.toLowerCase()}`}
      />
    </div>
  );
}

/** Shares an achievement's picture; one share at a time, and a label that names what it shares. */
export function ShareButton({
  title,
  lines,
  label,
}: {
  title: string;
  lines: readonly string[];
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const share = async () => {
    setBusy(true);
    try {
      await shareCard(title, lines);
    } catch (e) {
      // Drawing failed: nothing to share, and the page keeps working.
      console.warn("share card", e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className="ghost small win-share"
      disabled={busy}
      aria-label={label}
      onClick={share}
    >
      Compartilhar
    </button>
  );
}

const W = 1080;
const H = 1350;

const wrap = (ctx: CanvasRenderingContext2D, text: string, width: number) => {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
};

/** The brand mark (BrandMark.tsx) in its 80×52 box, drawn at `x, y` with the given width. */
const drawMark = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number) => {
  const k = width / 80;
  ctx.save();
  ctx.translate(x - 14 * k, y - 31 * k);
  ctx.scale(k, k);
  ctx.strokeStyle = "#1c1a17";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D("M18 78H30L35 37L48 50H58L71 37L76 66H90"));
  ctx.fillStyle = "#2a7548";
  for (const cx of [46.5, 59.5]) {
    ctx.beginPath();
    ctx.ellipse(cx, 61.5, 2.4, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const drawCard = async (title: string, lines: readonly string[]) => {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const font =
    getComputedStyle(document.documentElement).getPropertyValue("--sans") || "sans-serif";
  ctx.fillStyle = "#f6f5f1";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.font = `600 56px ${font}`;
  const rows = lines.flatMap((l, i) => [...(i > 0 ? [""] : []), ...wrap(ctx, l, W - 160)]);
  const rowsH = rows.reduce((h, r) => h + (r ? 68 : 28), 0);
  // Mark, title and wins as one block above the footer.
  const markW = 200;
  const markH = (markW * 52) / 80;
  let y = Math.max(60, (H - 140 - (markH + 80 + 44 + 90 + rowsH)) / 2);
  drawMark(ctx, (W - markW) / 2, y, markW);
  y += markH + 80 + 44;
  ctx.fillStyle = "#57534e";
  ctx.font = `500 44px ${font}`;
  ctx.fillText(title, W / 2, y);
  y += 90;
  ctx.font = `600 56px ${font}`;
  ctx.fillStyle = "#1c1a17";
  for (const r of rows) {
    if (r) ctx.fillText(r, W / 2, y);
    y += r ? 68 : 28;
  }
  ctx.fillStyle = "#57534e";
  ctx.font = `500 36px ${font}`;
  ctx.fillText("Neko · direto da minha planilha", W / 2, H - 80);
  return new Promise<Blob>((ok, fail) =>
    canvas.toBlob((b) => (b ? ok(b) : fail(new Error("png"))), "image/png"),
  );
};

/**
 * Shares a picture of an achievement where the browser can (phones), else downloads it:
 * the brand mark, a heading and the lines, never an amount.
 */
export const shareCard = async (title: string, lines: readonly string[]) => {
  const blob = await drawCard(title, lines);
  const file = new File([blob], "neko-conquista.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      // Closing the share sheet is not an error; anything else (the tap went stale while the
      // picture was drawn, say) falls back to the download below.
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
