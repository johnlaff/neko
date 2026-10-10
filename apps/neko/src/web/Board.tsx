import { type CSSProperties, type ReactNode, useLayoutEffect, useRef } from "react";

/** Grid rows are this tall on wide screens; a panel spans as many as its height needs. */
const ROW = 4;
const GAP = 20;

/**
 * A screen's panels: one after the other on a phone, in side-by-side columns on wider screens (two
 * from 48rem, three from 90rem), each column stacking its panels on its own, so a short panel never
 * leaves a hole beside a tall one. `two` and `three` list each column's panels, in the phone's
 * order column after column, so the keyboard reads down one column and then the next; a column left
 * with no panel drops out.
 *
 * The page keeps the phone's order and every panel stays mounted at any width: CSS only moves each
 * panel to its column (grid-auto-flow dense) and lets it span the rows its height needs. So the
 * keyboard and a screen reader read the same order everywhere, and resizing the window keeps what
 * was open or being typed.
 */
export const Board = <K extends string>({
  panels,
  two,
  three = two,
}: {
  panels: Record<K, ReactNode>;
  two: K[][];
  three?: K[][];
}) => {
  const board = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = board.current;
    if (!el) return;
    // Measured before paint, so a panel that grows (a section opened) pushes the next one down.
    const sized = new ResizeObserver((entries) => {
      for (const { target, contentRect } of entries)
        (target as HTMLElement).style.setProperty(
          "--rows",
          String(Math.max(1, Math.ceil((contentRect.height + GAP) / ROW))),
        );
    });
    for (const cell of el.children) sized.observe(cell);
    return () => sized.disconnect();
  }, []);
  const keys = Object.keys(panels) as K[];
  const place = (layout: K[][]) => {
    const cols = layout.map((col) => col.filter((k) => panels[k])).filter((col) => col.length > 0);
    const at = (k: K) => cols.findIndex((col) => col.includes(k)) + 1;
    return { count: cols.length, at };
  };
  const twoCols = place(two);
  const threeCols = place(three);
  return (
    <div
      ref={board}
      className="board"
      style={{ "--two": twoCols.count, "--three": threeCols.count } as CSSProperties}
    >
      {keys.map((k) => (
        <div
          key={k}
          className="cell"
          style={{ "--col2": twoCols.at(k) || 1, "--col3": threeCols.at(k) || 1 } as CSSProperties}
        >
          {panels[k]}
        </div>
      ))}
    </div>
  );
};
