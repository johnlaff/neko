import type { ReactNode } from "react";
import { categoryOf } from "../shared/categories.ts";

/**
 * A line's icon by what it is about (a house for the rent, a cap for the college), drawn like the
 * rest of the icons; a line that names no known kind keeps the generic icon it is given.
 */
export const CategoryIcon = ({ text, fallback }: { text: string; fallback: ReactNode }) => {
  const c = categoryOf(text);
  if (!c) return <>{fallback}</>;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-category={c.slug}
    >
      <path d={c.icon} />
    </svg>
  );
};
