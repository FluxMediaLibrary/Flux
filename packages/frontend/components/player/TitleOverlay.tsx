'use client';

import { BackIcon } from './icons';

interface TitleOverlayProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
}

/**
 * Top gradient overlay with back button, title, and subtitle.
 * Auto-hides with the control bar.
 */
export function TitleOverlay({ title, subtitle, onBack }: TitleOverlayProps) {
  return (
    <div className="fx-top">
      {onBack && (
        <button className="fx-btn" type="button" onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
      )}
      <div className="fx-titlewrap">
        <div className="fx-title">{title}</div>
        {subtitle && <div className="fx-subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}
