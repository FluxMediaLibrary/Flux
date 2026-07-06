'use client';

/**
 * Renders a profile avatar. When the profile's `avatar` matches a premade
 * preset, we show that preset's emoji on its gradient; otherwise we fall back
 * to the first initial of the name on the accent colour. Used by the profile
 * picker and the member nav so avatars look identical everywhere.
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
    fontSize: preset ? size * 0.5 : size * 0.42,
    ...(preset ? { background: preset.gradient } : {}),
  };
  return (
    <span
      className={`avatar-tile${className ? ` ${className}` : ''}`}
      style={style}
      aria-hidden="true"
    >
      {preset ? preset.emoji : initial(name)}
    </span>
  );
}
