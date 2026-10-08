import type { ReactNode } from "react";

/** Stroke icons drawn on a 24px grid; they inherit color and size from CSS. */
const Svg = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const IconToday = () => (
  <Svg>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
    <circle cx="12" cy="15" r="1.5" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconCard = () => (
  <Svg>
    <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
    <path d="M2.5 10h19M6.5 15h4" />
  </Svg>
);
export const IconMonth = () => (
  <Svg>
    <path d="M4 19.5h16M7 16v-4M12 16V8M17 16v-6" />
  </Svg>
);
export const IconSettings = () => (
  <Svg>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Svg>
);
export const IconChevron = () => (
  <Svg>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const IconChevronLeft = () => (
  <Svg>
    <path d="m15 6-6 6 6 6" />
  </Svg>
);
export const IconExternal = () => (
  <Svg>
    <path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </Svg>
);
export const IconRefresh = () => (
  <Svg>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v5h-5" />
  </Svg>
);
export const IconPlus = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconReceipt = () => (
  <Svg>
    <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" />
    <path d="M9 8.5h6M9 12.5h4" />
  </Svg>
);
export const IconRepeat = () => (
  <Svg>
    <path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3" />
    <path d="M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3" />
  </Svg>
);
export const IconEye = () => (
  <Svg>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const IconEyeOff = () => (
  <Svg>
    <path d="M10.6 5.6A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.5" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </Svg>
);
export const IconAlert = () => (
  <Svg>
    <path d="M12 4 2.8 19.5h18.4z" />
    <path d="M12 10v4.5M12 17.2v.3" />
  </Svg>
);
export const IconTrendUp = () => (
  <Svg>
    <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
  </Svg>
);
export const IconIncome = () => (
  <Svg>
    <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
  </Svg>
);
export const IconPhone = () => (
  <Svg>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M10.5 18.5h3" />
  </Svg>
);
export const IconLaptop = () => (
  <Svg>
    <rect x="4.5" y="5" width="15" height="10.5" rx="1.5" />
    <path d="M2.5 19h19" />
  </Svg>
);
