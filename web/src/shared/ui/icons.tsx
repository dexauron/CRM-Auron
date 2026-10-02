// Значки в духе SF Symbols: линия 1.8, скруглённые концы. Только SVG-разметка, без вставки HTML.
import type { ReactElement } from 'react';

const paths = {
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronLeft: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  clear: (
    <>
      <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
      <path d="M9 9l6 6M15 9l-6 6" stroke="var(--surface)" />
    </>
  ),
  chevronUpDown: <path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" />,
  bag: <path d="M5.5 8.5h13l-1 11.5h-11zM9 8.5V7a3 3 0 0 1 6 0v1.5" />,
  truck: (
    <>
      <path d="M2.5 6.5h11v10h-11zM13.5 10h4l3 3.2v3.3h-7" />
      <circle cx="7" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5c0-3.3 2.7-5.3 6-5.3s6 2 6 5.3M16.5 5.6a2.8 2.8 0 0 1 0 5.4M18 14.4c2 .5 3.5 2 3.5 4.6" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />,
  chart: <path d="M5 19.5V12M12 19.5V5M19 19.5v-7.5" />,
  share: <path d="M12 3.5v11M7.5 8L12 3.5 16.5 8M5.5 12.5V20h13v-7.5" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.2" />
      <path d="M5.5 15V6.2A2.2 2.2 0 0 1 7.7 4h8.3" />
    </>
  ),
  warning: <path d="M12 9.5v4M12 17h.01M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15" />,
  telegram: <path d="M21 4.5 2.8 11.6c-.8.3-.8 1.4 0 1.7l4.6 1.6 1.8 5.6c.2.7 1.1.9 1.6.4l2.6-2.4 4.6 3.4c.6.4 1.4.1 1.6-.6L22.3 5.8c.2-.9-.6-1.6-1.3-1.3zM7.4 14.9 18 8.2l-8.3 7.9" />,
  barcode: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M8 8.5v7M10.5 8.5v7M13.5 8.5v7M16 8.5v7" />
    </>
  ),
  flashlight: <path d="M8 3.5h8v3.2l-2 2.8v11h-4v-11l-2-2.8zM12 13v2.5" />,
  shield: <path d="M12 3.5l7 2.6v5.4c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6.1zM9 12l2.2 2.2L15.5 10" />,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof paths;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
