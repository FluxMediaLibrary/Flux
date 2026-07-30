/**
 * @flux/shared — API contract shared by backend and frontend.
 *
 * These are the wire (JSON) shapes returned/accepted by the REST API.
 * They intentionally mirror — but are decoupled from — the Prisma models.
 * Enums here MUST match packages/backend/prisma/schema.prisma.
 */

// ─── Enums (mirror schema.prisma) ─────────────────────────────────────────────

export type Role = 'ADMIN' | 'MEMBER';
export type AdminPermission =
  | 'MANAGE_LIBRARY'
  | 'MANAGE_REQUESTS'
  | 'MANAGE_DOWNLOADS'
  | 'MANAGE_USERS'
  | 'VIEW_SYSTEM'
  | 'CHANGE_SETTINGS'
  | 'VIEW_LOGS'
  | 'RESTART_SERVICES'
  | 'DELETE_MEDIA';
export const ADMIN_PERMISSIONS: AdminPermission[] = [
  'MANAGE_LIBRARY',
  'MANAGE_REQUESTS',
  'MANAGE_DOWNLOADS',
  'MANAGE_USERS',
  'VIEW_SYSTEM',
  'CHANGE_SETTINGS',
  'VIEW_LOGS',
  'RESTART_SERVICES',
  'DELETE_MEDIA',
];
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
  permissions: AdminPermission[];
  createdAt: string;
}

export interface ProfileDTO {
  id: string;
  name: string;
  avatar: string | null;
  hasPin: boolean;
  createdAt: string;
}

/** JWT payload. `activeProfileId` is set once a profile is selected. */
export interface JwtClaims {
  sub: string; // account (User) id
  role: Role;
  activeProfileId?: string;
  purpose?: 'account' | 'stream' | 'cast-playback';
}

export interface ClientBootstrapDTO {
  product: 'flux';
  serverId: string;
  serverName: string;
  serverVersion: string;
  apiVersion: number;
  minimumApiVersion: number;
  branding: {
    name: string;
    logoUrl: string | null;
    accentColor: string;
    backgroundColor: string;
  };
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

export interface ActivateProfileRequest {
  pin?: string;
}

export interface CreateProfileRequest {
  name: string;
  avatar?: string;
  pin?: string;
}

export interface UpdateProfileRequest {
  name?: string;
  avatar?: string | null;
  /** Four digits to set/change the PIN, or null to remove it. */
  pin?: string | null;
  /** Required whenever the profile PIN is added, changed, or removed. */
  accountPassword?: string;
}

export interface DeleteProfileRequest {
  /** Required when deleting a PIN-protected profile. */
  accountPassword?: string;
}

// ─── Premade avatars ──────────────────────────────────────────────────────────
// The catalogue is the shared source of truth for the backend allow-list and the
// frontend picker. Every file is local, project-owned artwork or an explicitly
// approved Flux zodiac asset.

export type AvatarCategory = 'Flux' | 'Sins' | 'Zodiac';

export interface AvatarPreset {
  id: string;
  /** Basename of the image file under public/avatars/. */
  file: string;
  /** Human label for tooltips / accessibility. */
  label: string;
  /** Section the avatar is grouped under in the picker. */
  category: AvatarCategory;
}

export const AVATAR_CATEGORY_ORDER: readonly AvatarCategory[] = [
  'Flux',
  'Sins',
  'Zodiac',
];

export const SAFE_DEFAULT_AVATAR_ID = 'flux-orbit';

export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  // ── Original Flux symbols and creatures ──
  { id: SAFE_DEFAULT_AVATAR_ID, file: 'flux-orbit.svg', label: 'Flux Orbit', category: 'Flux' },
  { id: 'flux-robot', file: 'flux-robot.svg', label: 'Robot', category: 'Flux' },
  { id: 'flux-astronaut', file: 'flux-astronaut.svg', label: 'Astronaut', category: 'Flux' },
  { id: 'flux-cat', file: 'flux-cat.svg', label: 'Cat', category: 'Flux' },
  { id: 'flux-fox', file: 'flux-fox.svg', label: 'Fox', category: 'Flux' },
  { id: 'flux-ghost', file: 'flux-ghost.svg', label: 'Ghost', category: 'Flux' },
  { id: 'flux-alien', file: 'flux-alien.svg', label: 'Alien', category: 'Flux' },
  { id: 'flux-void-mask', file: 'flux-void-mask.svg', label: 'Void Mask', category: 'Flux' },
  { id: 'flux-panda', file: 'flux-panda.svg', label: 'Panda', category: 'Flux' },
  { id: 'flux-bear', file: 'flux-bear.svg', label: 'Bear', category: 'Flux' },
  { id: 'flux-owl', file: 'flux-owl.svg', label: 'Owl', category: 'Flux' },
  { id: 'flux-frog', file: 'flux-frog.svg', label: 'Frog', category: 'Flux' },
  { id: 'flux-penguin', file: 'flux-penguin.svg', label: 'Penguin', category: 'Flux' },

  // ── Flux Seven Sins collection ──
  { id: 'sin-pride', file: 'sin-pride.svg', label: 'Pride', category: 'Sins' },
  { id: 'sin-greed', file: 'sin-greed.svg', label: 'Greed', category: 'Sins' },
  { id: 'sin-lust', file: 'sin-lust.svg', label: 'Lust', category: 'Sins' },
  { id: 'sin-envy', file: 'sin-envy.svg', label: 'Envy', category: 'Sins' },
  { id: 'sin-gluttony', file: 'sin-gluttony.svg', label: 'Gluttony', category: 'Sins' },
  { id: 'sin-wrath', file: 'sin-wrath.svg', label: 'Wrath', category: 'Sins' },
  { id: 'sin-sloth', file: 'sin-sloth.svg', label: 'Sloth', category: 'Sins' },

  // ── Zodiac ──
  { id: '9692_zodiac_aquarius', file: '9692_zodiac_aquarius.png', label: 'Aquarius', category: 'Zodiac' },
  { id: '7374_zodiac_ares', file: '7374_zodiac_ares.png', label: 'Aries', category: 'Zodiac' },
  { id: '6684_zodiac_cancer', file: '6684_zodiac_cancer.png', label: 'Cancer', category: 'Zodiac' },
  { id: '3112_zodiac_capricorn', file: '3112_zodiac_capricorn.png', label: 'Capricorn', category: 'Zodiac' },
  { id: '6663_zodiac_gemini', file: '6663_zodiac_gemini.png', label: 'Gemini', category: 'Zodiac' },
  { id: '7134_zodiac_leo', file: '7134_zodiac_leo.png', label: 'Leo', category: 'Zodiac' },
  { id: '1217_zodiac_libra', file: '1217_zodiac_libra.png', label: 'Libra', category: 'Zodiac' },
  { id: '3696_zodiac_pisces', file: '3696_zodiac_pisces.png', label: 'Pisces', category: 'Zodiac' },
  { id: '1186_zodiac_sagittarius', file: '1186_zodiac_sagittarius.png', label: 'Sagittarius', category: 'Zodiac' },
  { id: '5375_zodiac_scorpio', file: '5375_zodiac_scorpio.png', label: 'Scorpio', category: 'Zodiac' },
  { id: '3649_zodiac_taurus', file: '3649_zodiac_taurus.png', label: 'Taurus', category: 'Zodiac' },
  { id: '2303_zodiac_virgo', file: '2303_zodiac_virgo.png', label: 'Virgo', category: 'Zodiac' },

];

export const AVATAR_PRESET_IDS: readonly string[] = AVATAR_PRESETS.map((a) => a.id);
const AVATAR_PRESET_BY_ID = new Map(AVATAR_PRESETS.map((preset) => [preset.id, preset]));
const LEGACY_FLUX_AVATAR_IDS = new Map<string, string>([
  ['robot', 'flux-robot'],
  ['astronaut', 'flux-astronaut'],
  ['cat', 'flux-cat'],
  ['fox', 'flux-fox'],
  ['ghost', 'flux-ghost'],
  ['alien', 'flux-alien'],
  ['ninja', 'flux-void-mask'],
  ['panda', 'flux-panda'],
  ['bear', 'flux-bear'],
  ['owl', 'flux-owl'],
  ['frog', 'flux-frog'],
  ['penguin', 'flux-penguin'],
]);

/**
 * Preserve an explicit initials choice (`null`) while replacing stale bundled
 * preset ids with Flux's safe local default.
 */
export function normalizeAvatarPresetId(id: string | null | undefined): string | null {
  if (!id) return null;
  const migratedFluxId = LEGACY_FLUX_AVATAR_IDS.get(id);
  if (migratedFluxId) return migratedFluxId;
  return AVATAR_PRESET_BY_ID.has(id) ? id : SAFE_DEFAULT_AVATAR_ID;
}

/** Existing user-owned image references are data, not bundled preset ids. */
export function isUserAvatarReference(value: string | null | undefined): value is string {
  if (!value || value.startsWith('/avatars/')) return false;
  return value.startsWith('/')
    || value.startsWith('data:image/')
    || /^https?:\/\//i.test(value);
}

/** Normalize bundled ids while leaving existing user-owned images untouched. */
export function normalizeProfileAvatarReference(
  value: string | null | undefined,
): string | null {
  if (isUserAvatarReference(value)) return value;
  return normalizeAvatarPresetId(value);
}

/** Look up a preset, resolving a stale non-null id to the safe Flux default. */
export function getAvatarPreset(id: string | null | undefined): AvatarPreset | undefined {
  if (isUserAvatarReference(id)) return undefined;
  const normalized = normalizeAvatarPresetId(id);
  return normalized ? AVATAR_PRESET_BY_ID.get(normalized) : undefined;
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

export interface TmdbPersonResult {
  tmdbId: number;
  name: string;
  profilePath: string | null;
  knownForDepartment: string | null;
  knownFor: TmdbSearchResult[];
}

export interface TmdbCastMember {
  name: string;
  character: string;
  profilePath: string | null;
}

export interface TmdbCrewMember {
  name: string;
  job: string;
  department: string;
  profilePath: string | null;
}

export interface TmdbReviewDTO {
  author: string;
  rating: number | null;
  content: string;
  url: string | null;
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
  crew: TmdbCrewMember[];
  reviews: TmdbReviewDTO[];
  similar: TmdbSearchResult[];
  /** YouTube key for trailer embed, if available. */
  trailerYoutubeKey: string | null;
  imdbId: string | null;
  ageRating: string | null;
  status: string | null;
  tagline: string | null;
  originalLanguage: string | null;
  spokenLanguages: string[];
  countries: string[];
  studios: string[];
  budget: number | null;
  revenue: number | null;
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
  runtimeMinutes: number | null;
  contentRating: string | null;
  rating: number | null;
  addedAt: string;
}

export interface PlaybackMarkerDTO {
  type: 'intro' | 'credits';
  startSeconds: number;
  endSeconds: number;
}

export interface EpisodeDTO {
  id: string;
  season: number;
  episode: number;
  title: string | null;
  overview: string | null;
  runtime: number | null;
  available: boolean; // has a file
  playbackMarkers?: PlaybackMarkerDTO[];
  /** Per-profile watch progress for this episode (present on detail views). */
  progress?: WatchProgressDTO | null;
}

export interface MediaItemDetailDTO extends MediaItemDTO {
  episodes?: EpisodeDTO[];
  progress?: WatchProgressDTO | null;
  playbackMarkers?: PlaybackMarkerDTO[];
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
  newReleases: MediaItemDTO[];
  topRated: MediaItemDTO[];
  recommended: MediaItemDTO[];
  randomPicks: MediaItemDTO[];
  byGenre: { genre: string; items: MediaItemDTO[] }[];
  errors?: HomeRowErrorDTO[];
}

export interface HomeRowErrorDTO {
  id: string;
  title: string;
  code: string;
  message: string;
  retryable: boolean;
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

// ─── Media analysis ───────────────────────────────────────────────────────────

export interface MediaStreamDTO {
  id: string;
  type: 'video' | 'audio' | 'subtitle';
  index: number;
  codec: string | null;
  profile: string | null;
  level: number | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  framerate: number | null;
  hdr: string | null;
  channels: number | null;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
}

export interface MediaInfoDTO {
  id: string;
  container: string;
  durationSec: number;
  sizeBytes: number;
  hasVideo: boolean;
  hasAudio: boolean;
  hasSubtitles: boolean;
  streams: MediaStreamDTO[];
}

export interface PlaybackInfoDTO {
  directPlay: boolean;
  hlsAvailable: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  durationSeconds: number | null;
  streams: MediaStreamDTO[];
  qualities: {
    label: 'Auto' | 'Original' | '4K' | '1440p' | '1080p' | '720p' | '480p' | '360p';
    width: number | null;
    height: number | null;
    bitrate: number | null;
    available: boolean;
    source: 'direct' | 'hls';
  }[];
  /** Short-lived media-only credential. Never use the account JWT in media URLs. */
  streamToken: string;
  streamTokenExpiresAt: string;
}

export interface CastPlaybackInfoDTO {
  sessionId: string;
  url: string;
  contentType: 'video/mp4' | 'application/x-mpegURL';
  streamType: 'BUFFERED';
  method: 'direct' | 'hls';
  title: string;
  subtitle: string | null;
  posterUrl: string | null;
  durationSeconds: number | null;
  expiresAt: string;
  warnings: string[];
}

/** A Cast receiver-safe text track. URLs are scoped to one Cast session. */
export interface CastSubtitleTrackDTO {
  id: number;
  language: string;
  label: string;
  mimeType: 'text/vtt';
  url: string;
}

export interface CreateCastSessionRequest {
  mediaItemId: string;
  episodeId?: string;
  positionSeconds?: number;
}

// ─── Requests (per-profile) ───────────────────────────────────────────────────

export interface RequestDTO {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year?: number | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  genres?: string[];
  season: number | null;
  episode: number | null;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  /** Admin view only: which profile/account requested. */
  requestedBy?: { profileId: string; profileName: string; accountEmail: string };
  /** Admin view only: acquisition row fulfilling this request, when linked. */
  torrent?: {
    id: string;
    name: string;
    status: TorrentStatus;
    progress: number;
    errorMessage: string | null;
  } | null;
}

export interface AdminRequestFulfillmentSyncResultDTO {
  scanned: number;
  fulfilled: number;
}

export interface CreateRequestRequest {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  season?: number | null;
  episode?: number | null;
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
  linkedRequest?: {
    id: string;
    title: string;
    status: RequestStatus;
    requestedBy?: { profileId: string; profileName: string; accountEmail: string };
  } | null;
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

export interface TorrentClientHealthDTO {
  ok: boolean;
  url: string;
  version?: string;
  peerPort?: number;
  peerPortOpen?: boolean;
  dhtEnabled?: boolean;
  pexEnabled?: boolean;
  message?: string;
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
    mediaRoots: StorageRootDTO[];
    downloadRoot: StorageRootDTO;
    transcodeRoot: StorageRootDTO;
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
  library: {
    movies: number;
    shows: number;
    availableMovies: number;
    availableEpisodes: number;
    unavailableMovies: number;
    unavailableEpisodes: number;
    missingMetadata: number;
    missingAnalysis: number;
    brokenFiles: number;
    orphanProgress: number;
    transcodeSessions: number;
    transcodeBytes: number;
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

export interface StorageRootDTO {
  path: string;
  exists: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
  usedBytes: number | null;
}

export interface AdminLibraryEpisodeDTO {
  id: string;
  season: number;
  episode: number;
  title: string | null;
  overview: string | null;
  filePath: string | null;
  available: boolean;
  fileExists: boolean | null;
  analyzed: boolean;
  runtime: number | null;
}

export interface AdminLibrarySeasonDTO {
  season: number;
  expectedEpisodes: number | null;
  syncedEpisodes: number;
  availableEpisodes: number;
  missingEpisodes: number;
  brokenEpisodes: number;
  unanalyzedEpisodes: number;
  missingEpisodeNumbers: number[];
  brokenEpisodeNumbers: number[];
}

export interface AdminLibraryRequestDTO {
  id: string;
  status: RequestStatus;
  season: number | null;
  episode: number | null;
  requestedBy?: { profileId: string; profileName: string; accountEmail: string };
}

export interface AdminLibraryAcquisitionTargetDTO {
  key: string;
  reason: 'MISSING_FILE' | 'BROKEN_FILE' | 'MISSING_METADATA' | 'UNSYNCED_EPISODES';
  season: number | null;
  episode: number | null;
  requestId: string | null;
  label: string;
  detail: string;
  tone: 'bad' | 'warn';
  syncSeason: number | null;
  priority: number;
}

export interface AdminLibraryItemDTO {
  id: string;
  tmdbId: number;
  type: MediaType;
  title: string;
  year: number | null;
  posterPath: string | null;
  addedAt: string;
  available: boolean;
  fileExists: boolean | null;
  analyzed: boolean;
  episodeCount: number;
  expectedEpisodes: number | null;
  availableEpisodes: number;
  missingEpisodes: number;
  brokenEpisodes: number;
  unanalyzedEpisodes: number;
  issues: string[];
  seasons?: AdminLibrarySeasonDTO[];
  episodes?: AdminLibraryEpisodeDTO[];
  requests: AdminLibraryRequestDTO[];
  acquisitionTargets: AdminLibraryAcquisitionTargetDTO[];
}

export interface AdminLibraryHealthDTO {
  summary: {
    items: number;
    movies: number;
    shows: number;
    availableItems: number;
    missingFiles: number;
    missingAnalysis: number;
    brokenFiles: number;
    unavailableEpisodes: number;
  };
  items: AdminLibraryItemDTO[];
}

export interface AdminEpisodeSyncResultDTO {
  mediaItemId: string;
  seasons: number;
  episodes: number;
  created: number;
  updated: number;
}

export interface AdminBulkEpisodeSyncResultDTO {
  shows: number;
  seasons: number;
  episodes: number;
  created: number;
  updated: number;
  failed: number;
}

export interface AdminMediaAnalyzeResultDTO {
  mediaItemId: string;
  analyzed: number;
  skipped: number;
  failed: number;
}

export interface AdminLibraryRepairResultDTO {
  mediaItemId: string;
  episodeId: string | null;
  cleared: boolean;
}

export interface AdminMediaDeleteResultDTO {
  mediaItemId: string;
  episodeId: string | null;
  deletedRecords: number;
  deletedFiles: number;
  deletedBytes: number;
  skippedFiles: string[];
}

export interface AdminBulkMediaAnalyzeResultDTO {
  items: number;
  analyzed: number;
  skipped: number;
  failed: number;
}

export interface AdminStorageCleanupResultDTO {
  root: string;
  maxAgeSeconds: number;
  scannedEntries: number;
  deletedEntries: number;
  deletedBytes: number;
  skippedEntries: string[];
}

export type AdminHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
export type AdminAttentionSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AdminSignalDTO {
  generatedAt: string;
  status: AdminHealthStatus;
  counts: {
    pendingRequests: number;
    activeDownloads: number;
    failedDownloads: number;
    libraryIssues: number;
    activeStreams: number;
  };
  storagePercent: number | null;
}

export interface AdminAttentionItemDTO {
  id: string;
  severity: AdminAttentionSeverity;
  kind:
    | 'DOWNLOAD_FAILED'
    | 'LIBRARY_BROKEN'
    | 'METADATA_MISSING'
    | 'ANALYSIS_MISSING'
    | 'STORAGE_WARNING'
    | 'SERVICE_OFFLINE'
    | 'REQUEST_PENDING';
  title: string;
  detail: string;
  href: string;
  count: number;
}

export interface AdminActivityEventDTO {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  result: 'SUCCESS' | 'FAILURE' | 'INFO';
  details: string | null;
}

export interface AdminPlaybackSessionDTO {
  id: string;
  profileId: string;
  profileName: string;
  accountEmail: string;
  mediaItemId: string | null;
  episodeId: string | null;
  title: string;
  subtitle: string | null;
  positionSeconds: number;
  durationSeconds: number | null;
  progress: number | null;
  updatedAt: string;
  state: 'ACTIVE' | 'RECENT';
}

export interface AdminOverviewDTO {
  generatedAt: string;
  signal: AdminSignalDTO;
  stats: {
    mediaItems: number;
    users: number;
    pendingRequests: number;
    activeDownloads: number;
    failedJobs: number;
    activeStreams: number;
    storageUsedBytes: number | null;
    storageTotalBytes: number | null;
  };
  playback: AdminPlaybackSessionDTO[];
  attention: AdminAttentionItemDTO[];
  activity: AdminActivityEventDTO[];
}

export interface AdminUserDTO {
  id: string;
  email: string;
  role: Role;
  permissions: AdminPermission[];
  disabled: boolean;
  requestLimit: number | null;
  streamLimit: number | null;
  profiles: { id: string; name: string; avatar: string | null }[];
  requestCount: number;
  currentStreamCount: number;
  lastActiveAt: string | null;
  createdAt: string;
}

export interface UpdateAdminUserRequest {
  role?: Role;
  permissions?: AdminPermission[];
  disabled?: boolean;
  requestLimit?: number | null;
  streamLimit?: number | null;
}
