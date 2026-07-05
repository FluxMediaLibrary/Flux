'use client';

const LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Vertical A–Z quick-jump rail. Present letters are active; others disabled. */
export function AlphabetIndex({
  present,
  onJump,
}: {
  present: Set<string>;
  onJump: (letter: string) => void;
}) {
  return (
    <nav className="alpha" aria-label="Jump to letter">
      {LETTERS.map((l) => (
        <button
          key={l}
          type="button"
          className="alpha__btn"
          disabled={!present.has(l)}
          onClick={() => onJump(l)}
        >
          {l}
        </button>
      ))}
    </nav>
  );
}
