'use client';

/**
 * Renders a profile avatar. When the profile's `avatar` matches a premade
 * preset, we show that preset's hand-drawn SVG icon; otherwise we fall back to
 * the first initial of the name on the accent colour. Used by the profile
 * picker and the member nav so avatars look identical everywhere.
 */
import { AVATAR_ICONS } from '@/components/avatar-icons';

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
  const icon = avatar ? AVATAR_ICONS[avatar] : undefined;
  const style: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: size * 0.42,
  };
  return (
    <span
      className={`avatar-tile${icon ? ' has-icon' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      aria-hidden="true"
    >
      {icon ?? initial(name)}
    </span>
  );
}
