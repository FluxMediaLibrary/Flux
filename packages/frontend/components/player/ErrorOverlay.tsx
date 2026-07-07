import { type ReactNode } from 'react';

interface ErrorOverlayProps {
  message: string;
  onRetry?: () => void;
  children?: ReactNode;
}

/**
 * Full-screen error overlay shown when playback fails.
 * Pulses in smoothly with a centered message and retry button.
 */
export function ErrorOverlay({ message, onRetry, children }: ErrorOverlayProps) {
  return (
    <div className="fx-error">
      <p className="fx-error-msg">{message}</p>
      {onRetry && (
        <button className="fx-error-retry" onClick={onRetry}>
          Retry
        </button>
      )}
      {children}
    </div>
  );
}
