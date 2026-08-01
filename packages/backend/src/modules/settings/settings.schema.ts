import { z } from 'zod';

const nullablePositiveInt = z.number().int().positive().max(1_000_000).nullable();

export const updateSettingsSchema = z.object({
  general: z.object({
    serverName: z.string().trim().min(1).max(80).optional(),
    frontendUrl: z.string().url().optional(),
    apiUrl: z.string().url().nullable().optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
    language: z.string().trim().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
    defaultInviteExpiryHours: z.number().int().min(1).max(8760).optional(),
  }).strict().optional(),
  downloads: z.object({
    automatedDownloads: z.boolean().optional(),
    preferredProtocol: z.enum(['TORRENT_ONLY', 'USENET_ONLY', 'PREFER_TORRENT', 'PREFER_USENET', 'EITHER']).optional(),
    defaultDownloadClientId: z.string().cuid().nullable().optional(),
    defaultQualityProfileId: z.string().cuid().nullable().optional(),
    automaticSearch: z.boolean().optional(),
    automaticUpgrades: z.boolean().optional(),
    retryFailedDownloads: z.boolean().optional(),
    minimumFreeSpaceGb: z.number().int().min(0).max(1_000_000).optional(),
    completedImportBehavior: z.enum(['COPY', 'MOVE']).optional(),
    torrentSeedRatio: z.number().min(0).max(1000).nullable().optional(),
    torrentSeedTimeMinutes: nullablePositiveInt.optional(),
    torrentRemoveAfterSeeding: z.boolean().optional(),
    usenetRemoveCompleted: z.boolean().optional(),
    usenetRemoveFailed: z.boolean().optional(),
  }).strict().optional(),
  playback: z.object({
    directPlayEnabled: z.boolean().optional(),
    directStreamEnabled: z.boolean().optional(),
    transcodingEnabled: z.boolean().optional(),
    localBitrateLimitMbps: nullablePositiveInt.optional(),
    remoteBitrateLimitMbps: nullablePositiveInt.optional(),
    hardwareAcceleration: z.enum(['NONE', 'AUTO', 'VAAPI', 'QSV', 'NVENC', 'VIDEOTOOLBOX']).optional(),
    preferredAudioLanguage: z.string().trim().min(2).max(40).nullable().optional(),
    preferredSubtitleLanguage: z.string().trim().min(2).max(40).nullable().optional(),
    subtitlesMode: z.enum(['OFF', 'FOREIGN_ONLY', 'ALWAYS']).optional(),
    autoplayEnabled: z.boolean().optional(),
    resumeBehavior: z.enum(['ASK', 'ALWAYS', 'RESTART']).optional(),
    skipIntroEnabled: z.boolean().optional(),
  }).strict().optional(),
  integrations: z.object({
    tmdbApiKey: z.string().trim().min(8).max(512).nullable().optional(),
  }).strict().optional(),
}).strict();

export const saveDownloadClientSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['TRANSMISSION', 'SABNZBD', 'NZBGET']),
  enabled: z.boolean(),
  host: z.string().trim().min(1).max(500),
  port: z.number().int().min(1).max(65535),
  useHttps: z.boolean(),
  username: z.string().trim().max(200).nullable().optional(),
  credential: z.string().max(1000).nullable().optional(),
  category: z.string().trim().max(100).nullable().optional(),
  priority: z.number().int().min(-1000).max(1000),
  isDefault: z.boolean(),
}).strict().superRefine((value, context) => {
  if (!/^https?:\/\//i.test(value.host)) return;
  try {
    const url = new URL(value.host);
    if (url.username || url.password) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['host'], message: 'Put credentials in the dedicated username and credential fields' });
    }
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['host'], message: 'Enter a valid absolute URL or hostname' });
  }
});

export const qualityRuleSchema = z.object({
  id: z.string().trim().min(1).max(80),
  attribute: z.string().trim().min(1).max(120),
  kind: z.enum(['REQUIRED', 'PREFERRED', 'REJECTED']),
  score: z.number().int().min(-10000).max(10000),
}).strict();

const stringList = z.array(z.string().trim().min(1).max(80)).max(100);

export const saveQualityProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  allowedResolutions: stringList,
  sourceTypes: stringList,
  videoCodecs: stringList,
  hdrFormats: stringList,
  audioFormats: stringList,
  audioChannels: stringList,
  languages: stringList,
  releaseGroups: stringList,
  minimumSizeMb: z.number().int().min(0).max(10_000_000).nullable(),
  maximumSizeMb: z.number().int().min(1).max(10_000_000).nullable(),
  rules: z.array(qualityRuleSchema).max(200),
  upgradeCutoffScore: z.number().int().min(-100000).max(100000),
  minimumScoreImprovement: z.number().int().min(1).max(100000),
}).strict().superRefine((value, context) => {
  if (value.minimumSizeMb !== null && value.maximumSizeMb !== null && value.minimumSizeMb > value.maximumSizeMb) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maximumSizeMb'], message: 'Maximum size must be greater than minimum size' });
  }
  if (new Set(value.rules.map((rule) => rule.id)).size !== value.rules.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['rules'], message: 'Rule identifiers must be unique' });
  }
});

export const testReleaseSchema = z.object({
  title: z.string().trim().min(1).max(1000),
  sizeMb: z.number().min(0).max(10_000_000).nullable().optional(),
}).strict();

export const selectReleaseSchema = z.object({
  candidates: z.array(testReleaseSchema.extend({ id: z.string().trim().min(1).max(200) })).min(1).max(200),
  currentScore: z.number().int().min(-100000).max(100000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.candidates.map((candidate) => candidate.id)).size !== value.candidates.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['candidates'], message: 'Candidate identifiers must be unique' });
  }
});

export const queueUsenetReleaseSchema = z.object({
  candidates: z.array(testReleaseSchema.extend({
    id: z.string().trim().min(1).max(200),
    nzbUrl: z.string().url().max(4000).refine((value) => /^https?:\/\//i.test(value), 'NZB URL must use HTTP or HTTPS'),
  })).min(1).max(200),
  currentScore: z.number().int().min(-100000).max(100000).nullable().optional(),
  downloadClientId: z.string().cuid().nullable().optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.candidates.map((candidate) => candidate.id)).size !== value.candidates.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['candidates'], message: 'Candidate identifiers must be unique' });
  }
});
