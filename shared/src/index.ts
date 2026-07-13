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
// A curated catalogue of selectable avatar images. `avatar` on a Profile stores
// the preset `id`; the backend validates it against AVATAR_PRESET_IDS (or accepts
// null for an initials fallback). The image files live in the frontend under
// public/avatars/ and are rendered as `/avatars/${file}`. The catalogue itself is
// AUTO-GENERATED into ./avatars.ts (see scripts) so the source images, the
// backend allow-list, and the picker can never drift apart.

export type AvatarCategory = 'Emotes' | 'Characters' | 'Zodiac' | 'Fallout' | 'Icons';

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
  'Characters',
  'Zodiac',
  'Fallout',
  'Icons',
];

// Curated from the source images in packages/frontend/public/avatars/. Categories
// were verified by eye (the filenames alone mixed Fallout Vault-Boy art into the
// blue-smiley "Emotes" set).
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
  { id: '7868-owo', file: '7868-owo.png', label: 'OwO', category: 'Emotes' },
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
  { id: 'tribal', file: 'tribal.png', label: 'Tribal', category: 'Emotes' },

  // ── Characters (animated) ──
  { id: '27221-arielfacepalm', file: '27221-arielfacepalm.gif', label: 'Ariel Facepalm', category: 'Characters' },
  { id: '78677-arielhi', file: '78677-arielhi.gif', label: 'Ariel Hi', category: 'Characters' },
  { id: '71980-ariellove', file: '71980-ariellove.gif', label: 'Ariel Love', category: 'Characters' },
  { id: '90370-arielsad', file: '90370-arielsad.gif', label: 'Ariel Sad', category: 'Characters' },
  { id: '36305-arielsteam', file: '36305-arielsteam.gif', label: 'Ariel Steam', category: 'Characters' },
  { id: '54371-arielwhat', file: '54371-arielwhat.gif', label: 'Ariel What', category: 'Characters' },
  { id: '74336-aristocathappy', file: '74336-aristocathappy.gif', label: 'Aristocat Happy', category: 'Characters' },
  { id: '79985-aristocathi', file: '79985-aristocathi.gif', label: 'Aristocat Hi', category: 'Characters' },
  { id: '13350-aristocatlove', file: '13350-aristocatlove.gif', label: 'Aristocat Love', category: 'Characters' },
  { id: '74926-aristocatmad', file: '74926-aristocatmad.gif', label: 'Aristocat Mad', category: 'Characters' },
  { id: '97162-aristocatno', file: '97162-aristocatno.gif', label: 'Aristocat No', category: 'Characters' },
  { id: '53848-aristocattongue', file: '53848-aristocattongue.gif', label: 'Aristocat Tongue', category: 'Characters' },
  { id: '77535-aristocatwhat', file: '77535-aristocatwhat.gif', label: 'Aristocat What', category: 'Characters' },
  { id: '50074-bambigrimace', file: '50074-bambigrimace.gif', label: 'Bambi Grimace', category: 'Characters' },
  { id: '39738-funkymothman', file: '39738-funkymothman.gif', label: 'Funky Mothman', category: 'Characters' },
  { id: '3031-princess', file: '3031-princess.png', label: 'Princess', category: 'Characters' },
  { id: '62157-sebhuh', file: '62157-sebhuh.gif', label: 'Seb Huh', category: 'Characters' },
  { id: '75618-sebshock', file: '75618-sebshock.gif', label: 'Seb Shock', category: 'Characters' },

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

  // ── Fallout (Vault Boy poses + Nuka-Cola) ──
  { id: '5002-fallout', file: '5002-fallout.png', label: 'Vault Boy', category: 'Fallout' },
  { id: '1734-vaultboy', file: '1734-vaultboy.png', label: 'Vault Boy', category: 'Fallout' },
  { id: '3139-vaultboyholdup', file: '3139-vaultboyholdup.png', label: 'Vault Boy Hold Up', category: 'Fallout' },
  { id: '8364_fallout_ok', file: '8364_fallout_ok.png', label: 'Thumbs Up', category: 'Fallout' },
  { id: '2902-hola', file: '2902-hola.png', label: 'Wave', category: 'Fallout' },
  { id: '9368-enojo', file: '9368-enojo.png', label: 'Angry', category: 'Fallout' },
  { id: '4912-triste', file: '4912-triste.png', label: 'Sad', category: 'Fallout' },
  { id: '1612-mareo', file: '1612-mareo.png', label: 'Dizzy', category: 'Fallout' },
  { id: '3718-muerto', file: '3718-muerto.png', label: 'Dead', category: 'Fallout' },
  { id: '2408_gross_boy', file: '2408_gross_boy.png', label: 'Tongue Out', category: 'Fallout' },
  { id: '72568-hesitant', file: '72568-hesitant.png', label: 'Silly', category: 'Fallout' },
  { id: '6844-fiesta', file: '6844-fiesta.png', label: 'Party', category: 'Fallout' },
  { id: '4299-santoperonotanto', file: '4299-santoperonotanto.png', label: 'Angel', category: 'Fallout' },
  { id: '4299-sabiondo', file: '4299-sabiondo.png', label: 'Know-It-All', category: 'Fallout' },
  { id: '7285-fachero', file: '7285-fachero.png', label: 'Cool', category: 'Fallout' },
  { id: '5623-postolero', file: '5623-postolero.png', label: 'Pistol', category: 'Fallout' },
  { id: '1826-tecreo', file: '1826-tecreo.png', label: 'Heavy Gun', category: 'Fallout' },
  { id: '5703-cuchillo', file: '5703-cuchillo.png', label: 'Knife', category: 'Fallout' },
  { id: '5558-misterio', file: '5558-misterio.png', label: 'Detective', category: 'Fallout' },
  { id: '3718-nukacola', file: '3718-nukacola.png', label: 'Nuka-Cola', category: 'Fallout' },
  { id: '8871-chapa', file: '8871-chapa.png', label: 'Nuka Cap', category: 'Fallout' },
  { id: '1826-pipboy', file: '1826-pipboy.png', label: 'Pip-Boy', category: 'Fallout' },
  { id: '7968_fallout_pip_boy', file: '7968_fallout_pip_boy.png', label: 'Pip-Boy', category: 'Fallout' },
  { id: '79732-quantum-queers-logo', file: '79732-quantum-queers-logo.png', label: 'Quantum Queers', category: 'Fallout' },

  // ── Icons (small objects + critters) ──
  { id: '422848-bunny', file: '422848-bunny.png', label: 'Bunny', category: 'Icons' },
  { id: '532883-cash', file: '532883-cash.png', label: 'Cash', category: 'Icons' },
  { id: '421918-cat', file: '421918-cat.png', label: 'Cat', category: 'Icons' },
  { id: '809351-crown', file: '809351-crown.png', label: 'Crown', category: 'Icons' },
  { id: '618492-diamond', file: '618492-diamond.png', label: 'Diamond', category: 'Icons' },
  { id: '96311-dog', file: '96311-dog.png', label: 'Dog', category: 'Icons' },
  { id: '391926-frog', file: '391926-frog.png', label: 'Frog', category: 'Icons' },
  { id: '605187-goat', file: '605187-goat.png', label: 'Goat', category: 'Icons' },
  { id: '1545-1000031285', file: '1545-1000031285.png', label: 'Owl', category: 'Icons' },
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
  newReleases: MediaItemDTO[];
  topRated: MediaItemDTO[];
  recommended: MediaItemDTO[];
  randomPicks: MediaItemDTO[];
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
}

// ─── Requests (per-profile) ───────────────────────────────────────────────────

export interface RequestDTO {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
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
    mediaRoot: StorageRootDTO;
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

export interface AdminBulkMediaAnalyzeResultDTO {
  items: number;
  analyzed: number;
  skipped: number;
  failed: number;
}
