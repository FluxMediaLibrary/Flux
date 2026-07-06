/**
 * @flux/shared — API contract shared by backend and frontend.
 *
 * These are the wire (JSON) shapes returned/accepted by the REST API.
 * They intentionally mirror — but are decoupled from — the Prisma models.
 * Enums here MUST match packages/backend/prisma/schema.prisma.
 */

// ─── Enums (mirror schema.prisma) ─────────────────────────────────────────────

export type Role = 'ADMIN' | 'MEMBER';
export type MediaType = 'MOVIE' | 'SHOW';
export type TorrentStatus =
  | 'PENDING_CONFIRM'
  | 'DOWNLOADING'
  | 'PROCESSING'
  | 'SEEDING'
  | 'STOPPED'
  | 'ERROR';
export type RequestStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'DOWNLOADING'
  | 'FULFILLED'
  | 'REJECTED';

// ─── Auth / accounts / profiles ───────────────────────────────────────────────

export interface AccountDTO {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface ProfileDTO {
  id: string;
  name: string;
  avatar: string | null;
  createdAt: string;
}

/** JWT payload. `activeProfileId` is set once a profile is selected. */
export interface JwtClaims {
  sub: string; // account (User) id
  role: Role;
  activeProfileId?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  email: string;
  password: string;
  inviteCode: string;
}

/** Returned by login/signup. Token has no active profile until one is selected. */
export interface AuthResponse {
  token: string;
  account: AccountDTO;
  profiles: ProfileDTO[];
}

/** Returned by profile activation — a new token carrying activeProfileId. */
export interface ActivateProfileResponse {
  token: string;
  profile: ProfileDTO;
}

export interface CreateProfileRequest {
  name: string;
  avatar?: string;
}

export interface UpdateProfileRequest {
  name?: string;
  avatar?: string | null;
}

// ─── Premade avatars ──────────────────────────────────────────────────────────
// A curated catalogue of selectable avatars. `avatar` on a Profile stores the
// preset `id`; the backend validates it against this list (or accepts null for
// an initials fallback). The actual artwork is a set of hand-drawn SVG icons
// that live in the frontend (components/avatar-icons.tsx) keyed by these ids —
// this module is the single source of truth for which ids are valid, so the
// backend and frontend can never drift.

export interface AvatarPreset {
  id: string;
  /** Human label for accessibility / tooltips. */
  label: string;
}

export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  { id: 'robot', label: 'Robot' },
  { id: 'astronaut', label: 'Astronaut' },
  { id: 'cat', label: 'Cat' },
  { id: 'fox', label: 'Fox' },
  { id: 'ghost', label: 'Ghost' },
  { id: 'alien', label: 'Alien' },
  { id: 'ninja', label: 'Ninja' },
  { id: 'panda', label: 'Panda' },
  { id: 'bear', label: 'Bear' },
  { id: 'owl', label: 'Owl' },
  { id: 'frog', label: 'Frog' },
  { id: 'penguin', label: 'Penguin' },
];

export const AVATAR_PRESET_IDS: readonly string[] = AVATAR_PRESETS.map((a) => a.id);

/** Look up a preset by id (undefined when the id is unknown or null). */
export function getAvatarPreset(id: string | null | undefined): AvatarPreset | undefined {
  if (!id) return undefined;
  return AVATAR_PRESETS.find((a) => a.id === id);
}

export interface InviteDTO {
  id: string;
  code: string;
  url: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface CreateInviteRequest {
  /** Hours until the invite expires. Defaults server-side. */
  expiresInHours?: number;
}

// ─── TMDb browse ──────────────────────────────────────────────────────────────

export interface TmdbSearchResult {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  /** TMDb average vote (0–10), or null when unrated. */
  voteAverage: number | null;
  /** True if this title already exists in the library (Play vs Request). */
  inLibrary: boolean;
  /** Present when inLibrary — the local media item id to play. */
  mediaItemId?: string;
}

export interface TmdbCastMember {
  name: string;
  character: string;
  profilePath: string | null;
}

/** A TMDb genre (id + display name), used for discover filters. */
export interface TmdbGenreDTO {
  id: number;
  name: string;
}

/** Discovery feeds share the same card shape as search results. */
export type TmdbDiscoverResult = TmdbSearchResult;

/** Time window for the trending feed. */
export type TrendingWindow = 'day' | 'week';

export interface TmdbDetail extends TmdbSearchResult {
  genres: string[];
  runtime: number | null;
  cast: TmdbCastMember[];
  /** YouTube key for trailer embed, if available. */
  trailerYoutubeKey: string | null;
  seasons?: { season: number; episodeCount: number; name: string }[];
}

/**
 * A single TMDb episode within a season — the richer metadata (still image,
 * synopsis, air date) the Netflix-style episode tiles render. Availability and
 * the local playable id come from the library {@link EpisodeDTO}, merged by
 * `episodeNumber`.
 */
export interface TmdbEpisode {
  episodeNumber: number;
  name: string | null;
  overview: string | null;
  /** TMDb still frame path (append to an image base), or null. */
  stillPath: string | null;
  runtime: number | null;
  airDate: string | null;
  /** TMDb average vote (0–10), or null when unrated. */
  voteAverage: number | null;
}

// ─── Library ──────────────────────────────────────────────────────────────────

export interface MediaItemDTO {
  id: string;
  tmdbId: number;
  type: MediaType;
  title: string;
  year: number | null;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  genres: string[];
  addedAt: string;
}

export interface EpisodeDTO {
  id: string;
  season: number;
  episode: number;
  title: string | null;
  overview: string | null;
  runtime: number | null;
  available: boolean; // has a file
  /** Per-profile watch progress for this episode (present on detail views). */
  progress?: WatchProgressDTO | null;
}

export interface MediaItemDetailDTO extends MediaItemDTO {
  episodes?: EpisodeDTO[];
  progress?: WatchProgressDTO | null;
}

/**
 * A library grid item — a MediaItemDTO plus the per-profile playback state the
 * grid badges encode (watched ✓ vs unplayed-episode count).
 */
export interface LibraryItemDTO extends MediaItemDTO {
  /** Available (has-file) episode count for shows; 0 for movies. */
  episodeCount: number;
  /** Unplayed available episodes for the active profile (shows); null for movies. */
  unplayedCount: number | null;
  /** Fully watched: movie completed, or all available episodes completed. */
  watched: boolean;
  /** Whether anything is playable yet (movie file, or ≥1 available episode). */
  available: boolean;
}

export interface HomeRowsDTO {
  continueWatching: ContinueWatchingItemDTO[];
  recentlyAdded: MediaItemDTO[];
  byGenre: { genre: string; items: MediaItemDTO[] }[];
}

export interface ContinueWatchingItemDTO {
  mediaItem: MediaItemDTO;
  episode: EpisodeDTO | null;
  progress: WatchProgressDTO;
}

// ─── Watch progress (per-profile) ─────────────────────────────────────────────

export interface WatchProgressDTO {
  mediaItemId: string | null;
  episodeId: string | null;
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  updatedAt: string;
}

export interface SaveProgressRequest {
  mediaItemId?: string;
  episodeId?: string;
  positionSeconds: number;
  durationSeconds?: number;
}

// ─── Requests (per-profile) ───────────────────────────────────────────────────

export interface RequestDTO {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  /** Admin view only: which profile/account requested. */
  requestedBy?: { profileId: string; profileName: string; accountEmail: string };
}

export interface CreateRequestRequest {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
}

// ─── Torrents (admin) ─────────────────────────────────────────────────────────

export interface TorrentFileGuess {
  path: string;        // internal file path in the torrent
  season: number | null;
  episode: number | null;
}

/** Result of parsing an uploaded .torrent, shown for admin confirm/correct. */
export interface TorrentParseResult {
  infoHash: string;
  name: string;
  guessedTitle: string;
  guessedYear: number | null;
  guessedType: MediaType;
  files: TorrentFileGuess[];
}

/** Admin's confirmed mapping before download starts. */
export interface ConfirmTorrentRequest {
  infoHash: string;
  category: MediaType;
  tmdbId: number;
  title: string;
  year: number | null;
  /** For season packs: confirmed per-file season/episode mapping. */
  fileMapping?: { path: string; season: number; episode: number }[];
  /** Optional: link to a pending request to fulfill on completion. */
  requestId?: string;
}

export interface TorrentDTO {
  id: string;
  infoHash: string;
  name: string;
  category: MediaType;
  matchedTmdbId: number | null;
  status: TorrentStatus;
  progress: number;       // 0..1
  downloadSpeed: number;  // bytes/s
  uploadSpeed: number;
  peers: number;
  totalBytes: number;
  uploadedBytes: number;
  ratio: number;
  seedingSince: string | null;
  errorMessage: string | null;
  createdAt: string;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export interface NotificationSettingsDTO {
  discordEnabled: boolean;
  discordWebhookUrl: string | null;
  smtpEnabled: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  smtpFromAddress: string | null;
  // smtpPassword is write-only; never returned.
}

export interface UpdateNotificationSettingsRequest {
  discordEnabled?: boolean;
  discordWebhookUrl?: string | null;
  smtpEnabled?: boolean;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUsername?: string | null;
  smtpPassword?: string | null;
  smtpFromAddress?: string | null;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

// ─── Admin dashboard ───────────────────────────────────────────────────────

export interface AdminInfoDTO {
  system: {
    uptime: number;
    nodeVersion: string;
    platform: string;
    memory: { total: number; free: number; used: number };
    cpuLoad: number[];
  };
  storage: {
    mediaRoot: string;
    downloadRoot: string;
    transcodeRoot: string;
  };
  database: {
    users: number;
    profiles: number;
    mediaItems: number;
    episodes: number;
    torrents: number;
    requests: number;
    invites: number;
  };
  torrents: {
    downloading: number;
    seeding: number;
    stopped: number;
    error: number;
    processing: number;
  };
  requests: {
    pending: number;
    approved: number;
    fulfilled: number;
    rejected: number;
    downloading: number;
  };
  errors: { name: string; message: string; since: string }[];
}
