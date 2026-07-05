'use client';

/**
 * Ambient backdrop — a fixed, blurred, darkened image layer that gives the dark
 * UI its colour (Jellyfin-style). Pages set the current backdrop via `useAmbient`;
 * the layer cross-fades when it changes and falls back to a gradient when unset.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';

const AmbientContext = createContext<(src: string | null) => void>(() => {});

export function AmbientProvider({ children }: { children: ReactNode }) {
  const [src, setSrc] = useState<string | null>(null);

  return (
    <AmbientContext.Provider value={setSrc}>
      <div className="ambient" aria-hidden="true">
        {src && (
          <img
            key={src}
            className="ambient-img"
            src={`${BACKDROP_BASE}${src}`}
            alt=""
            fetchPriority="low"
          />
        )}
        <div className="ambient-veil" />
      </div>
      <div className="member-content">{children}</div>
    </AmbientContext.Provider>
  );
}

/**
 * Set the ambient backdrop to a TMDb backdrop path (or clear it) for as long as
 * the calling component is mounted.
 */
export function useAmbient(backdropPath: string | null | undefined): void {
  const setSrc = useContext(AmbientContext);
  useEffect(() => {
    setSrc(backdropPath ?? null);
    return () => setSrc(null);
  }, [backdropPath, setSrc]);
}
