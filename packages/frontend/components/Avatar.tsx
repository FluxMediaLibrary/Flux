'use client';

/**
 * Renders a profile avatar. When the profile's `avatar` matches a premade
 * preset, we show that preset's image (from /public/avatars); otherwise we fall
 * back to the first initial of the name on the accent colour. Used by the
 * profile picker and the navbar so avatars look identical everywhere.
 */
import { getAvatarPreset } from '@flux/shared';

function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

interface AvatarProps {
  name: string;
  avatar?: string | null;
  /** Tile size in px. */
  size?: number;
  className?: string;
}

export function Avatar({ name, avatar, size = 118, className }: AvatarProps) {
  const preset = getAvatarPreset(avatar);
  const style: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: size * 0.42,
  };
  return (
    <span
      className={`avatar-tile${preset ? ' has-icon' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      aria-hidden="true"
    >
      {preset ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/avatars/${preset.file}`} alt="" draggable={false} />
      ) : (
        initial(name)
      )}
    </span>
  );
}
