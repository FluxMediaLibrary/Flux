import type { MediaStreamDTO, PlaybackInfoDTO, UpdateAudioPreferenceRequest } from '@flux/shared';

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  eng: 'English',
  ja: 'Japanese',
  jpn: 'Japanese',
  es: 'Spanish',
  spa: 'Spanish',
  fr: 'French',
  fra: 'French',
  fre: 'French',
  de: 'German',
  deu: 'German',
  ger: 'German',
  it: 'Italian',
  ita: 'Italian',
  ko: 'Korean',
  kor: 'Korean',
  zh: 'Chinese',
  zho: 'Chinese',
  chi: 'Chinese',
  pt: 'Portuguese',
  por: 'Portuguese',
  ru: 'Russian',
  rus: 'Russian',
};

function normalizeLanguage(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return null;
  return normalized.split('-')[0]!;
}

function languageLabel(value: string | null | undefined): string | null {
  const normalized = normalizeLanguage(value);
  if (!normalized) return null;
  return LANGUAGE_LABELS[normalized] ?? normalized.toUpperCase();
}

function cleanTitle(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function channelLabel(channels: number | null): string | null {
  if (!channels || !Number.isFinite(channels)) return null;
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return `${channels}ch`;
}

function codecLabel(codec: string | null): string | null {
  if (!codec) return null;
  const normalized = codec.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'eac3') return 'EAC3';
  if (normalized === 'ac3') return 'AC3';
  if (normalized === 'dts_hd_ma') return 'DTS-HD MA';
  if (normalized === 'truehd') return 'TrueHD';
  return normalized.toUpperCase();
}

export function audioStreamLabel(stream: MediaStreamDTO, fallback: string): string {
  const language = languageLabel(stream.language);
  const title = cleanTitle(stream.title);
  const primary = title && language && !title.toLowerCase().includes(language.toLowerCase())
    ? `${language} ${title}`
    : title ?? language ?? fallback;
  const details = [primary, channelLabel(stream.channels), codecLabel(stream.codec)].filter(Boolean);
  return details.join(' — ');
}

export function audioPreferenceFromStream(stream: MediaStreamDTO): UpdateAudioPreferenceRequest {
  return {
    language: stream.language?.trim() || null,
    title: cleanTitle(stream.title),
  };
}

export function selectedAudioStreamIndex(info: PlaybackInfoDTO): number | null {
  const audioStreams = info.streams.filter((stream) => stream.type === 'audio');
  if (audioStreams.length <= 1) return null;
  return audioStreams.some((stream) => stream.index === info.selectedAudioStreamIndex)
    ? info.selectedAudioStreamIndex
    : null;
}
