'use client';

import type { ReactNode } from 'react';

/** Responsive poster grid — auto-fills columns to the available width. */
export function PosterGrid({ children }: { children: ReactNode }) {
  return <div className="pgrid">{children}</div>;
}
