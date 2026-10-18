import type { SVGProps } from 'react';

// אייקונים בקו דק, בסגנון אחיד. כל האייקונים דקורטיביים (aria-hidden) — לכפתורים יש תווית טקסט.
const PATHS = {
  photo: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 18M15.5 9.5a1.5 1.5 0 1 0 0-.01',
  video: 'M3.5 7A2.5 2.5 0 0 1 6 4.5h8A2.5 2.5 0 0 1 16.5 7v10a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17zM16.5 10l4-2.5v9l-4-2.5',
  audio: 'M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v3.5M9 20.5h6',
  story: 'M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5c-3.5-.5-6.5 0-8.5 1.5zM12 6.5v13',
  document: 'M6 3.5h8l4 4v13H6zM14 3.5v4h4M8.5 11h7M8.5 14h7M8.5 17h4',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20',
  settings: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2l-.3 2h-3.9l-.3-2a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.4L3 9.9l2-3.4 1.9.7a7 7 0 0 1 2-1.2l.3-2h3.9l.3 2a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.4z',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14',
  trash: 'M5 7h14M10 4h4M7 7l1 13h8l1-13M10.5 10.5v6M13.5 10.5v6',
  restore: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4',
  edit: 'M14.5 5.5l4 4L8 20H4v-4zM12.5 7.5l4 4',
  close: 'M6 6l12 12M18 6 6 18',
  chevronLeft: 'M14.5 6 8.5 12l6 6',
  chevronRight: 'M9.5 6l6 6-6 6',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8 5.5v13M16 5.5v13',
  back15: 'M12 5a7.5 7.5 0 1 1-7.3 9.2M4.5 5v4.5H9',
  fwd15: 'M12 5a7.5 7.5 0 1 0 7.3 9.2M19.5 5v4.5H15',
  zoomIn: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20M10.5 8v5M8 10.5h5',
  zoomOut: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20M8 10.5h5',
  home: 'M4 11 12 4l8 7M6 9.5V20h4.5v-5.5h3V20H18V9.5',
  shuffle: 'M4 7h3.5c4 0 5 10 9 10H20M17.5 14.5 20 17l-2.5 2.5M4 17h3.5c1.5 0 2.6-1.4 3.4-3M13.1 10c.8-1.6 1.9-3 3.4-3H20M17.5 4.5 20 7l-2.5 2.5',
  heart: 'M12 19.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.3c0 5.4-7.5 10-7.5 10z',
  quote: 'M10 7.5H6.5A1.5 1.5 0 0 0 5 9v3.5h5V7.5zm0 5c0 2.5-1.5 4-4 4.5M19 7.5h-3.5A1.5 1.5 0 0 0 14 9v3.5h5V7.5zm0 5c0 2.5-1.5 4-4 4.5',
  user: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4.5 20a7.5 7.5 0 0 1 15 0',
  users: 'M9 5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM3 19.5a6 6 0 0 1 12 0M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14a6 6 0 0 1 3 5.5',
  logout: 'M14 4.5H6.5v15H14M10 12h10M16.5 8.5 20 12l-3.5 3.5',
  upload: 'M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 19.5h14',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  tag: 'M4 4.5h7.5L20 13l-7 7-8.5-8.5zM8 8.5a.5.5 0 1 0 0-.01',
  calendar: 'M5 6h14v14H5zM5 10h14M9 3.5V7M15 3.5V7',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  check: 'M5 12.5 10 17.5 19 7',
  alert: 'M12 4 21 19.5H3zM12 10v4.5M12 17.2v.1',
  archive: 'M3.5 5h17v4h-17zM5 9v10.5h14V9M10 13h4',
  shield: 'M12 3.5 19 6v6c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6z',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5',
  comment: 'M5 5h14v10H10l-4 4v-4H5z',
  sparkle: 'M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const filled = name === 'play';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export const KIND_ICON = { photo: 'photo', video: 'video', audio: 'audio', story: 'story', document: 'document' } as const;
