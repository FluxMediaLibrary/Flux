import type {
  ParsedReleaseDTO,
  QualityProfileDTO,
  ReleaseCandidateRequest,
  ReleaseScoreDTO,
  ReleaseSelectionDTO,
} from '@flux/shared';

function has(title: string, pattern: RegExp): boolean {
  return pattern.test(title);
}

function canonical(value: string): string {
  return value.toUpperCase().replace(/[._\s-]+/g, ' ').replace(/[^A-Z0-9:+ ]/g, '').trim();
}

function includesValue(values: string[], value: string | null): boolean {
  if (!value) return false;
  const target = canonical(value);
  return values.some((candidate) => canonical(candidate) === target);
}

export function parseReleaseTitle(title: string, sizeMb: number | null = null): ParsedReleaseDTO {
  const normalized = title.replace(/[._]/g, ' ');
  const resolution = has(normalized, /\b(2160p|4k)\b/i) ? '2160p'
    : has(normalized, /\b1080p\b/i) ? '1080p'
      : has(normalized, /\b720p\b/i) ? '720p'
        : has(normalized, /\b(576p|576i)\b/i) ? '576p'
          : has(normalized, /\b(480p|480i)\b/i) ? '480p'
            : null;
  const source = has(normalized, /\b(?:blu[ .-]?ray|b[rd]rip)\b/i) ? 'BluRay'
    : has(normalized, /\bremux\b/i) ? 'Remux'
      : has(normalized, /\bweb[ .-]?dl\b/i) ? 'WEB-DL'
        : has(normalized, /\bwebrip\b/i) ? 'WEBRip'
          : has(normalized, /\bhdtv\b/i) ? 'HDTV'
            : has(normalized, /\b(?:cam|hdcam|telesync|ts)\b/i) ? 'CAM'
              : null;
  // Remux is more specific than its BluRay carrier token.
  const resolvedSource = has(normalized, /\bremux\b/i) ? 'Remux' : source;
  const codec = has(normalized, /\b(?:av1)\b/i) ? 'AV1'
    : has(normalized, /\b(?:x265|h[ .-]?265|hevc)\b/i) ? 'HEVC'
      : has(normalized, /\b(?:x264|h[ .-]?264|avc)\b/i) ? 'H.264'
        : null;
  const hdr = [
    has(normalized, /\b(?:dolby[ .-]?vision|dovi|dv)\b/i) ? 'Dolby Vision' : null,
    has(normalized, /\bhdr10\+\b/i) ? 'HDR10+' : null,
    has(normalized, /\bhdr10\b/i) ? 'HDR10' : null,
    has(normalized, /\bhlg\b/i) ? 'HLG' : null,
  ].filter((value): value is string => Boolean(value));
  if (hdr.length === 0 && has(normalized, /\bhdr\b/i)) hdr.push('HDR');
  if (hdr.length === 0) hdr.push('SDR');
  const audio = [
    has(normalized, /\btrue[ .-]?hd\b/i) ? 'TrueHD' : null,
    has(normalized, /\batmos\b/i) ? 'Atmos' : null,
    has(normalized, /\bdts[ .-]?x\b/i) ? 'DTS:X' : null,
    has(normalized, /\bdts[ .-]?(?:hd|ma)\b/i) ? 'DTS-HD' : null,
    has(normalized, /\b(?:ddp|eac3|e-ac-3)\b/i) ? 'E-AC-3' : null,
    has(normalized, /\b(?:dd|ac3|ac-3)\b/i) ? 'AC-3' : null,
    has(normalized, /\bflac\b/i) ? 'FLAC' : null,
    has(normalized, /\baac\b/i) ? 'AAC' : null,
  ].filter((value): value is string => Boolean(value));
  const channelMatch = normalized.match(/(?:^|[^\d])(7\.1|5\.1|2\.0|1\.0)(?:[^\d]|$)/);
  const audioChannels = channelMatch?.[1] ?? (has(normalized, /\bstereo\b/i) ? '2.0' : null);
  const groupMatch = title.match(/-([A-Za-z0-9][A-Za-z0-9._-]{1,31})$/);
  const releaseGroup = groupMatch?.[1] ?? null;
  const languages = [
    has(normalized, /\b(?:english|eng)\b/i) ? 'English' : null,
    has(normalized, /\b(?:spanish|spa)\b/i) ? 'Spanish' : null,
    has(normalized, /\b(?:french|fre|fra)\b/i) ? 'French' : null,
    has(normalized, /\b(?:japanese|jpn)\b/i) ? 'Japanese' : null,
    has(normalized, /\b(?:german|ger|deu)\b/i) ? 'German' : null,
  ].filter((value): value is string => Boolean(value));

  const attributes = [resolution, resolvedSource, codec, ...hdr, ...audio, audioChannels, releaseGroup]
    .filter((value): value is string => Boolean(value));
  if (audioChannels === '2.0') attributes.push('Stereo');
  if (resolvedSource === 'CAM') attributes.push('CAM');

  return {
    title,
    resolution,
    source: resolvedSource,
    codec,
    hdr,
    audio,
    audioChannels,
    languages,
    releaseGroup,
    sizeMb,
    attributes: [...new Set(attributes)],
  };
}

export function scoreRelease(profile: QualityProfileDTO, title: string, sizeMb: number | null = null): ReleaseScoreDTO {
  const parsed = parseReleaseTitle(title, sizeMb);
  const rejectionReasons: string[] = [];
  const hardRules: [string, string[], string | null][] = [
    ['resolution', profile.allowedResolutions, parsed.resolution],
    ['source', profile.sourceTypes, parsed.source],
    ['video codec', profile.videoCodecs, parsed.codec],
    ['audio channels', profile.audioChannels, parsed.audioChannels],
    ['release group', profile.releaseGroups, parsed.releaseGroup],
  ];
  for (const [label, allowed, actual] of hardRules) {
    if (allowed.length === 0) continue;
    if (!actual) rejectionReasons.push(`Could not determine ${label}`);
    else if (!includesValue(allowed, actual)) rejectionReasons.push(`${actual} is not an allowed ${label}`);
  }
  if (profile.hdrFormats.length > 0 && !parsed.hdr.some((value) => includesValue(profile.hdrFormats, value))) {
    rejectionReasons.push(`${parsed.hdr.join(', ')} is not an allowed HDR format`);
  }
  if (profile.audioFormats.length > 0 && parsed.audio.length === 0) {
    rejectionReasons.push('Could not determine audio format');
  } else if (profile.audioFormats.length > 0 && !parsed.audio.some((value) => includesValue(profile.audioFormats, value))) {
    rejectionReasons.push(`${parsed.audio.join(', ')} is not an allowed audio format`);
  }
  if (profile.languages.length > 0 && parsed.languages.length === 0) {
    rejectionReasons.push('Could not determine language');
  } else if (profile.languages.length > 0 && !parsed.languages.some((value) => includesValue(profile.languages, value))) {
    rejectionReasons.push(`${parsed.languages.join(', ')} is not an allowed language`);
  }
  if (sizeMb !== null && profile.minimumSizeMb !== null && sizeMb < profile.minimumSizeMb) {
    rejectionReasons.push(`File is smaller than ${profile.minimumSizeMb} MB`);
  }
  if (sizeMb !== null && profile.maximumSizeMb !== null && sizeMb > profile.maximumSizeMb) {
    rejectionReasons.push(`File is larger than ${profile.maximumSizeMb} MB`);
  }

  const parsedAttributes = parsed.attributes.map(canonical);
  const evaluatedRules = profile.rules.map((rule) => {
    const matched = parsedAttributes.includes(canonical(rule.attribute));
    if (rule.kind === 'REQUIRED' && !matched) rejectionReasons.push(`Required attribute missing: ${rule.attribute}`);
    if (rule.kind === 'REJECTED' && matched) rejectionReasons.push(`Rejected attribute matched: ${rule.attribute}`);
    return {
      ...rule,
      matched,
      contribution: matched && rule.kind === 'PREFERRED' ? rule.score : 0,
    };
  });
  const totalScore = evaluatedRules.reduce((sum, rule) => sum + rule.contribution, 0);
  return {
    parsed,
    accepted: rejectionReasons.length === 0,
    totalScore,
    matchedRules: evaluatedRules.filter((rule) => rule.matched),
    rejectionReasons,
  };
}

export function selectRelease(
  profile: QualityProfileDTO,
  candidates: ReleaseCandidateRequest[],
  currentScore: number | null = null,
): ReleaseSelectionDTO {
  const evaluated = candidates.map((candidate) => ({
    ...candidate,
    result: scoreRelease(profile, candidate.title, candidate.sizeMb ?? null),
  }));
  const valid = evaluated.filter((candidate) => candidate.result.accepted).sort((a, b) =>
    b.result.totalScore - a.result.totalScore
    || (a.sizeMb ?? Number.MAX_SAFE_INTEGER) - (b.sizeMb ?? Number.MAX_SAFE_INTEGER)
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id),
  );
  const selected = valid[0] ?? null;
  if (!selected) return { selected: null, evaluated, upgradeAllowed: false, reason: 'No release passed the profile hard rules.' };
  if (currentScore === null) return { selected, evaluated, upgradeAllowed: true, reason: 'Highest-scoring valid release selected.' };
  if (currentScore >= profile.upgradeCutoffScore) {
    return { selected: null, evaluated, upgradeAllowed: false, reason: 'The current release already meets the upgrade cutoff.' };
  }
  const improvement = selected.result.totalScore - currentScore;
  if (improvement < profile.minimumScoreImprovement) {
    return { selected: null, evaluated, upgradeAllowed: false, reason: `Score improvement ${improvement} is below the required ${profile.minimumScoreImprovement}.` };
  }
  return { selected, evaluated, upgradeAllowed: true, reason: `Upgrade improves the score by ${improvement}.` };
}
