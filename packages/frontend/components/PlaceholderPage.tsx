import type { ReactNode } from 'react';

/**
 * Routed placeholder used across Phase-1 shell pages. Later phases replace the
 * body with the real feature. Keep the `TODO(phase-N)` markers so future
 * sessions can grep for unfinished surfaces.
 */
export function PlaceholderPage({
  title,
  todo,
  children,
}: {
  title: string;
  todo: string;
  children?: ReactNode;
}) {
  return (
    <section className="placeholder">
      <h1>{title}</h1>
      <p className="placeholder-todo">
        <span className="tag">TODO</span> {todo}
      </p>
      {children}
    </section>
  );
}
