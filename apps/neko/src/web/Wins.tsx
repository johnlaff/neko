import type { Win } from "@neko/engine";
import { useState } from "react";
import { winText } from "../shared/wins.ts";
import nekoComemorando from "./assets/mascots/neko-comemorando.webp";
import { capitalize, monthName } from "./format.ts";
import { Mascot } from "./Mascot.tsx";

/**
 * A closed month's wins with the celebrating Neko, and a share button that turns them into a
 * picture (4:5, the size feeds and chats crop to). The picture carries the wins only, never an
 * amount: what is shared is the achievement, not the finances.
 */
export function Wins({
  wins,
  year,
  month,
  cat,
  className,
}: {
  wins: readonly Win[];
  year: number;
  month: number;
  cat: number;
  className?: string | undefined;
}) {
  const [busy, setBusy] = useState(false);
  if (wins.length === 0) return null;
  const lines = wins.map(winText);
  const share = async () => {
    setBusy(true);
    try {
      await shareCard(`${capitalize(monthName(month))} de ${year}`, lines);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={className ? `recap-wins ${className}` : "recap-wins"}>
      <Mascot pose="celebrating" height={cat} className="milestone-cat" />
      <ul aria-label="Conquistas do mês">
        {lines.map((t, i) => (
          <li key={wins[i]?.kind}>{t}</li>
        ))}
      </ul>
      <button type="button" className="ghost small win-share" disabled={busy} onClick={share}>
        Compartilhar
      </button>
    </div>
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

const drawCard = async (title: string, lines: readonly string[]) => {
  const img = new Image();
  img.src = nekoComemorando;
  await img.decode();
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
  ctx.font = `650 56px ${font}`;
  const rows = lines.flatMap((l, i) => [...(i > 0 ? [""] : []), ...wrap(ctx, l, W - 160)]);
  const rowsH = rows.reduce((h, r) => h + (r ? 68 : 28), 0);
  const catH = 560;
  // Title, cat and wins as one block, centred above the footer.
  let y = Math.max(60, (H - 140 - (44 + 40 + catH + 90 + rowsH)) / 2) + 44;
  ctx.fillStyle = "#57534e";
  ctx.font = `500 44px ${font}`;
  ctx.fillText(`${title} fechou`, W / 2, y);
  const catW = (img.naturalWidth / img.naturalHeight) * catH;
  ctx.drawImage(img, (W - catW) / 2, y + 40, catW, catH);
  y += 40 + catH + 90;
  ctx.font = `650 56px ${font}`;
  ctx.fillStyle = "#2a7548";
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

/** Shares the picture where the browser can (phones), else downloads it. */
const shareCard = async (title: string, lines: readonly string[]) => {
  const blob = await drawCard(title, lines);
  const file = new File([blob], "neko-conquista.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${title} fechou` });
    } catch {
      // Closing the share sheet is not an error.
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
