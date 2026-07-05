'use client';

/**
 * BackgroundLayer — a fixed, heavily-blurred, dark-overlaid backdrop generated
 * from the currently selected media item. Backdrops crossfade when the selection
 * changes. Pages set the current backdrop via `useAmbient(backdropPath)`.
 *
 * Exported as AmbientProvider/useAmbient (stable names used across pages) and
 * BackgroundProvider/useBackdrop (spec aliases).
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';

const BackdropContext = createContext<(src: string | null) => void>(() => {});

interface Layer { id: number; src: string; }

function BackdropImage({ src }: { src: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);
  return (
    <img
      className={`bg-layer__img${shown ? ' shown' : ''}`}
      src={`${BACKDROP_BASE}${src}`}
      alt=""
      aria-hidden="true"
      fetchPriority="low"
    />
  );
}

function BackgroundLayer({ src }: { src: string | null }) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    if (!src) return;
    const id = (idRef.current += 1);
    // Keep the previous layer beneath the new one so they crossfade.
    setLayers((prev) => [...prev.slice(-1), { id, src }]);
    const t = setTimeout(
      () => setLayers((prev) => prev.filter((l) => l.id === id)),
      800,
    );
    return () => clearTimeout(t);
  }, [src]);

  return (
    <div className="bg-layer" aria-hidden="true">
      {layers.map((l) => (
        <BackdropImage key={l.id} src={l.src} />
      ))}
      <div className="bg-layer__overlay" />
      <div className="bg-layer__vignette" />
    </div>
  );
}

export function AmbientProvider({ children }: { children: ReactNode }) {
  const [src, setSrc] = useState<string | null>(null);
  return (
    <BackdropContext.Provider value={setSrc}>
      <BackgroundLayer src={src} />
      <div className="app-shell">{children}</div>
    </BackdropContext.Provider>
  );
}

/** Set the ambient backdrop to a TMDb backdrop path while mounted. */
export function useAmbient(backdropPath: string | null | undefined): void {
  const setSrc = useContext(BackdropContext);
  useEffect(() => {
    if (backdropPath) setSrc(backdropPath);
  }, [backdropPath, setSrc]);
}

// Spec-named aliases.
export const BackgroundProvider = AmbientProvider;
export const useBackdrop = useAmbient;
