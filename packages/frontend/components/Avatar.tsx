'use client';

/**
 * Renders a profile avatar. When the profile's `avatar` matches a premade
 * preset, we show that preset's local image. Stale preset ids resolve to Flux's
 * safe default, missing files retry that default, and an initial remains behind
 * the image as the final no-network/no-asset fallback.
 */
import {
  getAvatarPreset,
  isUserAvatarReference,
  SAFE_DEFAULT_AVATAR_ID,
} from '@flux/shared';
import { useEffect, useState } from 'react';

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
  const safeDefault = getAvatarPreset(SAFE_DEFAULT_AVATAR_ID);
  const safeDefaultSrc = safeDefault ? `/avatars/${safeDefault.file}` : null;
  const primaryImageSrc = isUserAvatarReference(avatar)
    ? avatar
    : preset
      ? `/avatars/${preset.file}`
      : null;
  // A user URL can fail before hydration, before React has attached onError.
  // Start those images on the local default and request the user image only
  // after mount so the failure handler is guaranteed to be live.
  const [imageSrc, setImageSrc] = useState(
    isUserAvatarReference(avatar) ? safeDefaultSrc : primaryImageSrc,
  );

  useEffect(() => {
    setImageSrc(primaryImageSrc);
  }, [primaryImageSrc]);
  const style: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: size * 0.42,
  };
  return (
    <span
      className={`avatar-tile${imageSrc ? ' has-icon' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      aria-hidden="true"
    >
      {imageSrc ? (
        <>
          <span className="avatar-tile-fallback">{initial(name)}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            onError={() => {
              if (safeDefaultSrc && imageSrc !== safeDefaultSrc) {
                setImageSrc(safeDefaultSrc);
                return;
              }
              setImageSrc(null);
            }}
          />
        </>
      ) : (
        initial(name)
      )}
    </span>
  );
}
