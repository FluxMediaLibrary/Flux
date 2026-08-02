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

export interface CreateProfileRequest {
  name: string;
  avatar?: string;
}

export interface UpdateProfileRequest {
  name?: string;
  avatar?: string | null;
}

// ─── Premade avatars ──────────────────────────────────────────────────────────
// A curated catalogue of selectable avatar images. `avatar` on a Profile stores
// the preset `id`; the backend validates it against AVATAR_PRESET_IDS (or accepts
// null for an initials fallback). The image files live in the frontend under
// public/avatars/ and are rendered as `/avatars/${file}`. The catalogue itself is
// AUTO-GENERATED into ./avatars.ts (see scripts) so the source images, the
// backend allow-list, and the picker can never drift apart.

export type AvatarCategory = 'Emotes' | 'Zodiac' | 'Icons';

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
  'Emotes',
  'Zodiac',
  'Icons',
];

// Curated from the source images in packages/frontend/public/avatars/. Categories
// are verified from the artwork rather than inferred from filenames alone.
export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  // ── Emotes (the blue-smiley reaction faces) ──
  { id: '60413-argue', file: '60413-argue.png', label: 'Argue', category: 'Emotes' },
  { id: '96763-beg', file: '96763-beg.png', label: 'Beg', category: 'Emotes' },
  { id: '91810-blank', file: '91810-blank.png', label: 'Blank', category: 'Emotes' },
  { id: '9137-gasp', file: '9137-gasp.png', label: 'Gasp', category: 'Emotes' },
  { id: '46615-goofy', file: '46615-goofy.png', label: 'Goofy', category: 'Emotes' },
  { id: '87893-laugh', file: '87893-laugh.png', label: 'Laugh', category: 'Emotes' },
  { id: '80808-nervous', file: '80808-nervous.png', label: 'Nervous', category: 'Emotes' },
  { id: '36063-okay', file: '36063-okay.png', label: 'Okay', category: 'Emotes' },
  { id: '84145-plead', file: '84145-plead.png', label: 'Plead', category: 'Emotes' },
  { id: '58272-regret', file: '58272-regret.png', label: 'Regret', category: 'Emotes' },
  { id: '9644-sad', file: '9644-sad.png', label: 'Sad', category: 'Emotes' },
  { id: '73697-scared', file: '73697-scared.png', label: 'Scared', category: 'Emotes' },
  { id: '38741-shades', file: '38741-shades.png', label: 'Shades', category: 'Emotes' },
  { id: '40335-shrug', file: '40335-shrug.png', label: 'Shrug', category: 'Emotes' },
  { id: '7938-shy', file: '7938-shy.png', label: 'Shy', category: 'Emotes' },
  { id: '34928-suspicious', file: '34928-suspicious.png', label: 'Suspicious', category: 'Emotes' },
  { id: '72467-tears', file: '72467-tears.png', label: 'Tears', category: 'Emotes' },
  { id: '69470-think', file: '69470-think.png', label: 'Think', category: 'Emotes' },
  { id: '92984-thumbsup', file: '92984-thumbsup.png', label: 'Thumbs Up', category: 'Emotes' },
  { id: '79627-innocent', file: '79627-innocent.png', label: 'Innocent', category: 'Emotes' },

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

  // ── Icons (small objects + critters) ──
  { id: '422848-bunny', file: '422848-bunny.png', label: 'Bunny', category: 'Icons' },
  { id: '532883-cash', file: '532883-cash.png', label: 'Cash', category: 'Icons' },
  { id: '421918-cat', file: '421918-cat.png', label: 'Cat', category: 'Icons' },
  { id: '809351-crown', file: '809351-crown.png', label: 'Crown', category: 'Icons' },
  { id: '618492-diamond', file: '618492-diamond.png', label: 'Diamond', category: 'Icons' },
  { id: '96311-dog', file: '96311-dog.png', label: 'Dog', category: 'Icons' },
  { id: '391926-frog', file: '391926-frog.png', label: 'Frog', category: 'Icons' },
  { id: '605187-goat', file: '605187-goat.png', label: 'Goat', category: 'Icons' },
  { id: '647772-pouch', file: '647772-pouch.png', label: 'Pouch', category: 'Icons' },
  { id: '55902-trophy', file: '55902-trophy.png', label: 'Trophy', category: 'Icons' },
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

/** Segment types stored in the reusable media_segments table. */
export type MediaSegmentType = 'INTRO' | 'RECAP' | 'CREDITS' | 'PREVIEW';
/** How a media segment was created. */
export type MediaSegmentSource = 'AUTOMATIC' | 'MANUAL';

/**
 * A reusable episode segment (intro/recap/credits/preview). Timestamps are
 * milliseconds from the start of the episode. `AUTOMATIC` rows are produced by
 * the intro-detection job and may be replaced by rescans; `MANUAL` rows are
 * admin-authored and are protected from automatic overwrites.
 */
export interface MediaSegmentDTO {
  id: string;
  episodeId: string;
  type: MediaSegmentType;
  startMs: number;
  endMs: number;
  confidence: number;
  source: MediaSegmentSource;
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
  /** Reusable segment markers for this episode (intro/recap/credits/preview). */
  segments?: MediaSegmentDTO[];
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
  preferences: {
    autoplayEnabled: boolean;
    resumeBehavior: 'ASK' | 'ALWAYS' | 'RESTART';
    skipIntroEnabled: boolean;
    preferredAudioLanguage: string | null;
    preferredSubtitleLanguage: string | null;
    subtitlesMode: 'OFF' | 'FOREIGN_ONLY' | 'ALWAYS';
  };
  /** Reusable segment markers for the requested episode. */
  segments?: MediaSegmentDTO[];
  streams: MediaStreamDTO[];
  qualities: {
    label: 'Auto' | 'Original' | '4K' | '1440p' | '1080p' | '720p' | '480p' | '360p';
    width: number | null;
    height: number | null;
    bitrate: number | null;
    available: boolean;
    source: 'direct' | 'hls';
  }[];
}

export interface AdminIntroRescanResultDTO {
  mediaItemId: string;
  season: number;
  force: boolean;
  queued: boolean;
  jobId: string;
  deduplicated: boolean;
}

export type AdminIntroScanJobState =
  | 'WAITING'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'FAILED'
  | 'DELAYED';

export type AdminIntroScanOutcome =
  | 'MATCHED'
  | 'NO_MATCH'
  | 'SKIPPED'
  | 'DISABLED';

export interface AdminIntroScanProgressDTO {
  stage: 'QUEUED' | 'LOADING' | 'FINGERPRINTING' | 'DETECTING' | 'STORING' | 'COMPLETE';
  current: number;
  total: number;
  percent: number;
  message: string;
}

export interface AdminIntroScanResultDTO {
  outcome: AdminIntroScanOutcome;
  enabled: boolean;
  mediaItemId: string;
  season: number;
  force: boolean;
  episodes: number;
  fingerprinted: number;
  detected: number;
  matched: number;
  skippedManual: number;
  failed: number;
}

export interface AdminIntroScanJobDTO {
  id: string;
  mediaItemId: string;
  title: string;
  season: number;
  force: boolean;
  state: AdminIntroScanJobState;
  progress: AdminIntroScanProgressDTO;
  attemptsMade: number;
  createdAt: string;
  processedAt: string | null;
  finishedAt: string | null;
  failedReason: string | null;
  result: AdminIntroScanResultDTO | null;
  logs?: string[];
}

export interface AdminIntroSeasonDTO {
  mediaItemId: string;
  title: string;
  posterPath: string | null;
  season: number;
  episodes: number;
  availableEpisodes: number;
  introMarkers: number;
  automaticMarkers: number;
  manualMarkers: number;
  coverage: number;
  latestJob: AdminIntroScanJobDTO | null;
}

export interface AdminIntroDashboardDTO {
  enabled: boolean;
  configuration: {
    windowMinutes: number;
    minimumSeconds: number;
    minimumConfidence: number;
    minimumCoverage: number;
  };
  summary: {
    shows: number;
    seasons: number;
    availableEpisodes: number;
    markedEpisodes: number;
    queued: number;
    active: number;
    failed: number;
  };
  seasons: AdminIntroSeasonDTO[];
  jobs: AdminIntroScanJobDTO[];
}

export interface QueueAdminIntroScansRequest {
  targets: { mediaItemId: string; season: number }[];
  force?: boolean;
}

export interface QueueAdminIntroScansResultDTO {
  jobs: AdminIntroRescanResultDTO[];
}

export interface CreateMediaSegmentRequest {
  type: MediaSegmentType;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface UpdateMediaSegmentRequest {
  type?: MediaSegmentType;
  startMs?: number;
  endMs?: number;
  confidence?: number;
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
  /**
   * Best-effort snapshot of whether this torrent's data already exists in the
   * download root. When `filesOnDisk > 0`, the confirm flow reuses the local
   * files (verify + seed) instead of re-downloading what's already there.
   */
  existingData?: {
    filesOnDisk: number;
    totalFiles: number;
    bytesOnDisk: number;
    totalBytes: number;
    missingBytes: number;
    complete: boolean;
  };
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
  /** Notification secrets are write-only. */
  discordWebhookUrl: null;
  discordWebhookConfigured: boolean;
  smtpEnabled: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  smtpFromAddress: string | null;
  smtpPasswordConfigured: boolean;
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

export interface SettingsTestResultDTO {
  ok: boolean;
  message: string;
}

export type PreferredDownloadProtocol =
  | 'TORRENT_ONLY'
  | 'USENET_ONLY'
  | 'PREFER_TORRENT'
  | 'PREFER_USENET'
  | 'EITHER';

export interface GeneralSettingsDTO {
  serverName: string;
  frontendUrl: string;
  apiUrl: string | null;
  timezone: string;
  language: string;
  defaultInviteExpiryHours: number;
}

export interface DownloadSettingsDTO {
  automatedDownloads: boolean;
  preferredProtocol: PreferredDownloadProtocol;
  defaultDownloadClientId: string | null;
  defaultQualityProfileId: string | null;
  automaticSearch: boolean;
  automaticUpgrades: boolean;
  retryFailedDownloads: boolean;
  minimumFreeSpaceGb: number;
  completedImportBehavior: 'COPY' | 'MOVE';
  torrentSeedRatio: number | null;
  torrentSeedTimeMinutes: number | null;
  torrentRemoveAfterSeeding: boolean;
  usenetRemoveCompleted: boolean;
  usenetRemoveFailed: boolean;
}

export interface PlaybackSettingsDTO {
  directPlayEnabled: boolean;
  directStreamEnabled: boolean;
  transcodingEnabled: boolean;
  localBitrateLimitMbps: number | null;
  remoteBitrateLimitMbps: number | null;
  hardwareAcceleration: 'NONE' | 'AUTO' | 'VAAPI' | 'QSV' | 'NVENC' | 'VIDEOTOOLBOX';
  preferredAudioLanguage: string | null;
  preferredSubtitleLanguage: string | null;
  subtitlesMode: 'OFF' | 'FOREIGN_ONLY' | 'ALWAYS';
  autoplayEnabled: boolean;
  resumeBehavior: 'ASK' | 'ALWAYS' | 'RESTART';
  skipIntroEnabled: boolean;
}

export interface IntegrationSettingsDTO {
  tmdbApiKeyConfigured: boolean;
  tmdbSource: 'DATABASE' | 'ENVIRONMENT';
}

export interface SettingsBundleDTO {
  general: GeneralSettingsDTO;
  storage: StoragePolicySettingsDTO;
  downloads: DownloadSettingsDTO;
  playback: PlaybackSettingsDTO;
  notifications: NotificationSettingsDTO;
  integrations: IntegrationSettingsDTO;
}

export interface StorageLibraryRootDTO {
  path: string;
  mountPath: string;
  label: string;
  primary: boolean;
  source: 'ENVIRONMENT' | 'MANAGED';
  available: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
}

export interface StorageDriveCandidateDTO {
  id: string;
  mountPath: string;
  suggestedRoot: string;
  label: string;
  filesystem: string;
  source: string;
  writable: boolean;
  alreadyAdded: boolean;
  primary: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
}

export interface StorageSettingsDTO {
  primaryRoot: string;
  roots: StorageLibraryRootDTO[];
}

export interface StoragePolicySettingsDTO {
  reserveSpaceGb: number;
}

export interface AddStorageDriveRequest {
  driveId: string;
}

export interface RemoveStorageDriveRequest {
  path: string;
}

export interface UpdateSettingsBundleRequest {
  general?: Partial<GeneralSettingsDTO>;
  storage?: Partial<StoragePolicySettingsDTO>;
  downloads?: Partial<DownloadSettingsDTO>;
  playback?: Partial<PlaybackSettingsDTO>;
  integrations?: { tmdbApiKey?: string | null };
}

export type DownloadClientType = 'TRANSMISSION' | 'SABNZBD' | 'NZBGET';

export interface DownloadClientDTO {
  id: string;
  name: string;
  type: DownloadClientType;
  enabled: boolean;
  host: string;
  port: number;
  useHttps: boolean;
  username: string | null;
  category: string | null;
  priority: number;
  isDefault: boolean;
  credentialConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveDownloadClientRequest {
  name: string;
  type: DownloadClientType;
  enabled: boolean;
  host: string;
  port: number;
  useHttps: boolean;
  username?: string | null;
  credential?: string | null;
  category?: string | null;
  priority: number;
  isDefault: boolean;
}

export interface DownloadClientTestResultDTO {
  ok: boolean;
  clientName: string;
  version: string | null;
  message: string;
}

export type QualityRuleKind = 'REQUIRED' | 'PREFERRED' | 'REJECTED';

export interface QualityRuleDTO {
  id: string;
  attribute: string;
  kind: QualityRuleKind;
  score: number;
}

export interface QualityProfileDTO {
  id: string;
  name: string;
  enabled: boolean;
  allowedResolutions: string[];
  sourceTypes: string[];
  videoCodecs: string[];
  hdrFormats: string[];
  audioFormats: string[];
  audioChannels: string[];
  languages: string[];
  releaseGroups: string[];
  minimumSizeMb: number | null;
  maximumSizeMb: number | null;
  rules: QualityRuleDTO[];
  upgradeCutoffScore: number;
  minimumScoreImprovement: number;
  createdAt: string;
  updatedAt: string;
}

export type SaveQualityProfileRequest = Omit<QualityProfileDTO, 'id' | 'createdAt' | 'updatedAt'>;

export interface ParsedReleaseDTO {
  title: string;
  resolution: string | null;
  source: string | null;
  codec: string | null;
  hdr: string[];
  audio: string[];
  audioChannels: string | null;
  languages: string[];
  releaseGroup: string | null;
  sizeMb: number | null;
  attributes: string[];
}

export interface MatchedQualityRuleDTO extends QualityRuleDTO {
  matched: boolean;
  contribution: number;
}

export interface ReleaseScoreDTO {
  parsed: ParsedReleaseDTO;
  accepted: boolean;
  totalScore: number;
  matchedRules: MatchedQualityRuleDTO[];
  rejectionReasons: string[];
}

export interface TestReleaseRequest {
  title: string;
  sizeMb?: number | null;
}

export interface ReleaseCandidateRequest extends TestReleaseRequest {
  id: string;
}

export interface SelectReleaseRequest {
  candidates: ReleaseCandidateRequest[];
  currentScore?: number | null;
}

export interface ReleaseSelectionDTO {
  selected: (ReleaseCandidateRequest & { result: ReleaseScoreDTO }) | null;
  evaluated: (ReleaseCandidateRequest & { result: ReleaseScoreDTO })[];
  upgradeAllowed: boolean;
  reason: string;
}

export interface QueueUsenetReleaseRequest {
  candidates: (ReleaseCandidateRequest & { nzbUrl: string })[];
  currentScore?: number | null;
  downloadClientId?: string | null;
}

export interface QueuedUsenetReleaseDTO {
  clientId: string;
  clientName: string;
  jobId: string;
  release: {
    id: string;
    title: string;
    sizeMb: number | null;
    score: number;
  };
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
