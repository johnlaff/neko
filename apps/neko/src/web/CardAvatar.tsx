import type { ReactNode } from "react";
import { type Institution, institutionOf } from "../shared/institutions.ts";
import { BANK_MARKS } from "./bankMarks.ts";

/** Two letters for a card's avatar: "Mercado Pago" → "MP", "Amazon" → "AM". */
export const monogram = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase();
};

/** The issuer's mark on its brand colour, in the same tile as every other avatar. */
const Mark = ({ inst }: { inst: Institution }) => {
  const mark = BANK_MARKS[inst.slug];
  return (
    <span
      className="avatar brand"
      aria-hidden="true"
      style={{ backgroundColor: inst.bg, color: inst.fg }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d={mark?.d} fillRule={mark?.evenOdd ? "evenodd" : undefined} />
      </svg>
    </span>
  );
};

/** A card's avatar: its bank's mark when the name says which bank, else two letters. */
export const CardAvatar = ({ name }: { name: string }) => {
  const inst = institutionOf(name);
  return inst ? (
    <Mark inst={inst} />
  ) : (
    <span className="avatar mono" aria-hidden="true">
      {monogram(name)}
    </span>
  );
};

/** A row's avatar: the bank's mark for a card line from a known bank, else the given icon. */
export const RowAvatar = ({
  card,
  className = "avatar",
  children,
}: {
  /** The card's name, when the line is a card. */
  card: string | null;
  className?: string;
  children: ReactNode;
}) => {
  const inst = card === null ? null : institutionOf(card);
  return inst ? (
    <Mark inst={inst} />
  ) : (
    <span className={className} aria-hidden="true">
      {children}
    </span>
  );
};
