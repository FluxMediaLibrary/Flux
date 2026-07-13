/**
 * Flux player icons — Lucide-style SVG icons for the player control bar.
 * Extracted from the old FluxPlayer.tsx, ready for import by new player components.
 */

const iconSize = { width: 20, height: 20 };
const iconSizeBig = { width: 34, height: 34 };

export function PlayIcon({ big }: { big?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={big ? iconSizeBig : iconSize}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function PauseIcon({ big }: { big?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={big ? iconSizeBig : iconSize}>
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}

export function SkipBackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconSize}>
      <path d="M11 4 4 9l7 5V4z" />
      <path d="M20 5a9 9 0 1 1-9-1" />
    </svg>
  );
}

export function SkipForwardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconSize}>
      <path d="M13 4l7 5-7 5V4z" />
      <path d="M4 5a9 9 0 1 0 9-1" />
    </svg>
  );
}

export function VolumeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={iconSize}>
      <path d="M4 9v6h4l5 5V4L8 9H4z" />
      <path d="M16 8a4 4 0 0 1 0 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={iconSize}>
      <path d="M4 9v6h4l5 5V4L8 9H4z" />
      <path d="M22 9l-6 6M16 9l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconSize}>
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
    </svg>
  );
}

export function FullscreenExitIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconSize}>
      <path d="M8 3v5H3M16 3v5h5M21 16h-5v5M3 16h5v5" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconSize}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconSize}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

export function CastIcon({ connected }: { connected: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconSize}>
      <path d="M2 16.1A5 5 0 0 1 5.9 20" />
      <path d="M2 12.05A9 9 0 0 1 9.95 20" />
      <path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
      <path d="M2 20h.01" />
      {connected && <rect x="4" y="6" width="16" height="9" rx="1" fill="currentColor" stroke="none" opacity="0.55" />}
    </svg>
  );
}

export function CastGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ width: 46, height: 46 }}>
      <path d="M2 16.1A5 5 0 0 1 5.9 20" />
      <path d="M2 12.05A9 9 0 0 1 9.95 20" />
      <path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
      <path d="M2 20h.01" />
    </svg>
  );
}

export function PictureInPictureIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconSize}>
      <rect x="10" y="10" width="12" height="8" rx="2" />
      <rect x="2" y="4" width="16" height="12" rx="2" />
    </svg>
  );
}
