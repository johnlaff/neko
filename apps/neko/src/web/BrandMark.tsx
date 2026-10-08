/**
 * The brand mark, the same drawing as the app icon (Android res/drawable/ic_launcher_foreground.xml
 * and public/icon-*.png): a month's balance line that rises into two ears, holds a plateau and ends
 * higher than it began (the month closes with money left over), with slit pupils so it reads as a
 * cat and not an "M". Here the line stops short of the edges. Decorative: the name sits next to it.
 */
export const BrandMark = ({ width = 88, className }: { width?: number; className?: string }) => (
  <svg
    className={className ? `brand-mark ${className}` : "brand-mark"}
    viewBox="14 31 80 52"
    width={width}
    height={(width * 52) / 80}
    aria-hidden="true"
  >
    <path
      d="M18 78H30L35 37L48 50H58L71 37L76 66H90"
      fill="none"
      stroke="currentColor"
      strokeWidth="6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <ellipse className="brand-eye" cx="46.5" cy="61.5" rx="2.4" ry="5.5" />
    <ellipse className="brand-eye" cx="59.5" cy="61.5" rx="2.4" ry="5.5" />
  </svg>
);
