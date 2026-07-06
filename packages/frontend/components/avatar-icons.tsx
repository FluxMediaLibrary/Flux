/**
 * Hand-drawn SVG avatar artwork, keyed by the preset ids declared in
 * `@flux/shared` (AVATAR_PRESETS). Each icon is a self-contained 100×100
 * illustration (background + character) that scales to any tile size. The
 * <Avatar> component clips it to a rounded tile.
 */
import type { ReactElement } from 'react';

const svg = (bg: string, children: ReactElement): ReactElement => (
  <svg viewBox="0 0 100 100" width="100%" height="100%" role="img">
    <rect width="100" height="100" fill={bg} />
    {children}
  </svg>
);

export const AVATAR_ICONS: Record<string, ReactElement> = {
  robot: svg(
    '#0e7490',
    <>
      <line x1="50" y1="26" x2="50" y2="16" stroke="#e2e8f0" strokeWidth="3" />
      <circle cx="50" cy="14" r="4" fill="#fbbf24" />
      <rect x="26" y="28" width="48" height="44" rx="13" fill="#e2e8f0" />
      <rect x="34" y="40" width="32" height="18" rx="9" fill="#0f172a" />
      <circle cx="42" cy="49" r="4" fill="#22d3ee" />
      <circle cx="58" cy="49" r="4" fill="#22d3ee" />
      <rect x="40" y="64" width="20" height="4" rx="2" fill="#94a3b8" />
    </>,
  ),
  astronaut: svg(
    '#4338ca',
    <>
      <circle cx="50" cy="52" r="28" fill="#f1f5f9" />
      <path d="M30 52a20 20 0 0 1 40 0Z" fill="#1e293b" />
      <rect x="30" y="50" width="40" height="6" fill="#1e293b" />
      <circle cx="42" cy="46" r="4" fill="#93c5fd" opacity="0.8" />
      <rect x="44" y="76" width="12" height="6" rx="2" fill="#cbd5e1" />
    </>,
  ),
  cat: svg(
    '#d97706',
    <>
      <path d="M30 34 34 54 22 50Z" fill="#fbbf24" />
      <path d="M70 34 66 54 78 50Z" fill="#fbbf24" />
      <circle cx="50" cy="56" r="24" fill="#fbbf24" />
      <circle cx="42" cy="52" r="3.5" fill="#0f172a" />
      <circle cx="58" cy="52" r="3.5" fill="#0f172a" />
      <path d="M46 60 50 63 54 60" fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M28 56h12M28 62h12M60 56h12M60 62h12" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" />
    </>,
  ),
  fox: svg(
    '#7c2d12',
    <>
      <path d="M26 30 40 46 30 54Z" fill="#f97316" />
      <path d="M74 30 60 46 70 54Z" fill="#f97316" />
      <path d="M50 30 74 44 62 72 50 80 38 72 26 44Z" fill="#f97316" />
      <path d="M50 56 62 66 50 80 38 66Z" fill="#fafafa" />
      <circle cx="41" cy="52" r="3.5" fill="#0f172a" />
      <circle cx="59" cy="52" r="3.5" fill="#0f172a" />
      <circle cx="50" cy="66" r="3.5" fill="#0f172a" />
    </>,
  ),
  ghost: svg(
    '#475569',
    <>
      <path d="M26 50a24 24 0 0 1 48 0v28l-8-6-8 6-8-6-8 6-8-6Z" fill="#f8fafc" />
      <circle cx="42" cy="48" r="4.5" fill="#334155" />
      <circle cx="58" cy="48" r="4.5" fill="#334155" />
      <ellipse cx="50" cy="60" rx="5" ry="6" fill="#334155" />
    </>,
  ),
  alien: svg(
    '#15803d',
    <>
      <path d="M50 24c16 0 24 12 24 28 0 14-10 26-24 26S26 66 26 52c0-16 8-28 24-28Z" fill="#86efac" />
      <path d="M38 50c0-5 3-8 6-8s5 4 4 9-4 8-6 7-4-3-4-8Z" fill="#0f172a" />
      <path d="M62 50c0-5-3-8-6-8s-5 4-4 9 4 8 6 7 4-3 4-8Z" fill="#0f172a" />
      <path d="M44 70h12" stroke="#166534" strokeWidth="2.5" strokeLinecap="round" />
    </>,
  ),
  ninja: svg(
    '#1f2937',
    <>
      <circle cx="50" cy="52" r="27" fill="#334155" />
      <path d="M23 44h54v16H23Z" fill="#0f172a" />
      <path d="M23 44a27 27 0 0 1 54 0Z" fill="#111827" />
      <circle cx="41" cy="52" r="4" fill="#f8fafc" />
      <circle cx="59" cy="52" r="4" fill="#f8fafc" />
    </>,
  ),
  panda: svg(
    '#64748b',
    <>
      <circle cx="32" cy="34" r="10" fill="#111827" />
      <circle cx="68" cy="34" r="10" fill="#111827" />
      <circle cx="50" cy="54" r="26" fill="#f8fafc" />
      <ellipse cx="40" cy="52" rx="7" ry="9" fill="#111827" transform="rotate(-18 40 52)" />
      <ellipse cx="60" cy="52" rx="7" ry="9" fill="#111827" transform="rotate(18 60 52)" />
      <circle cx="40" cy="52" r="3" fill="#f8fafc" />
      <circle cx="60" cy="52" r="3" fill="#f8fafc" />
      <ellipse cx="50" cy="64" rx="4" ry="3" fill="#111827" />
    </>,
  ),
  bear: svg(
    '#92400e',
    <>
      <circle cx="32" cy="36" r="11" fill="#b45309" />
      <circle cx="68" cy="36" r="11" fill="#b45309" />
      <circle cx="32" cy="36" r="5" fill="#78350f" />
      <circle cx="68" cy="36" r="5" fill="#78350f" />
      <circle cx="50" cy="54" r="26" fill="#b45309" />
      <ellipse cx="50" cy="62" rx="14" ry="11" fill="#fcd34d" />
      <circle cx="42" cy="50" r="3.5" fill="#1c1917" />
      <circle cx="58" cy="50" r="3.5" fill="#1c1917" />
      <ellipse cx="50" cy="58" rx="4" ry="3" fill="#1c1917" />
    </>,
  ),
  owl: svg(
    '#6d28d9',
    <>
      <path d="M28 30 38 44 26 46Z" fill="#a78bfa" />
      <path d="M72 30 62 44 74 46Z" fill="#a78bfa" />
      <path d="M50 26c16 0 26 14 26 30S66 82 50 82 24 72 24 56 34 26 50 26Z" fill="#a78bfa" />
      <circle cx="40" cy="50" r="11" fill="#f8fafc" />
      <circle cx="60" cy="50" r="11" fill="#f8fafc" />
      <circle cx="40" cy="50" r="5" fill="#1e1b4b" />
      <circle cx="60" cy="50" r="5" fill="#1e1b4b" />
      <path d="M46 60 50 66 54 60Z" fill="#fbbf24" />
    </>,
  ),
  frog: svg(
    '#166534',
    <>
      <circle cx="36" cy="36" r="12" fill="#22c55e" />
      <circle cx="64" cy="36" r="12" fill="#22c55e" />
      <circle cx="36" cy="36" r="5" fill="#0f172a" />
      <circle cx="64" cy="36" r="5" fill="#0f172a" />
      <path d="M22 50a28 22 0 0 0 56 0Z" fill="#22c55e" />
      <path d="M34 62q16 12 32 0" fill="none" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" />
    </>,
  ),
  penguin: svg(
    '#0c4a6e',
    <>
      <ellipse cx="50" cy="52" rx="26" ry="30" fill="#1e293b" />
      <ellipse cx="50" cy="58" rx="15" ry="22" fill="#f8fafc" />
      <circle cx="42" cy="42" r="3.5" fill="#0f172a" />
      <circle cx="58" cy="42" r="3.5" fill="#0f172a" />
      <path d="M44 48 50 56 56 48Z" fill="#f59e0b" />
    </>,
  ),
};
