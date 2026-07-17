import { randomUUID } from 'node:crypto';

export interface CastSessionGrant {
  id: string;
  accountId: string;
  profileId: string;
  mediaItemId: string;
  episodeId?: string;
  expiresAt: Date;
}

const sessions = new Map<string, CastSessionGrant>();

function prune(now = Date.now()): void {
  for (const [id, session] of sessions) {
    if (session.expiresAt.getTime() <= now) sessions.delete(id);
  }
}

export function createCastSession(input: Omit<CastSessionGrant, 'id'>): CastSessionGrant {
  prune();
  const session = { ...input, id: randomUUID() };
  sessions.set(session.id, session);
  return session;
}

export function isValidCastSession(input: Pick<CastSessionGrant, 'id' | 'accountId' | 'profileId' | 'mediaItemId' | 'episodeId'>): boolean {
  prune();
  const saved = sessions.get(input.id);
  return Boolean(saved && saved.accountId === input.accountId && saved.profileId === input.profileId &&
    saved.mediaItemId === input.mediaItemId && (saved.episodeId ?? undefined) === (input.episodeId ?? undefined));
}
