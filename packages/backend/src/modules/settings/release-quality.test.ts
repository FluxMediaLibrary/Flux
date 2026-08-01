import test from 'node:test';
import assert from 'node:assert/strict';
import type { QualityProfileDTO } from '@flux/shared';
import { parseReleaseTitle, scoreRelease, selectRelease } from './release-quality.js';

const profile: QualityProfileDTO = {
  id: 'balanced', name: 'Balanced 1080p', enabled: true,
  allowedResolutions: ['1080p'], sourceTypes: ['WEB-DL', 'BluRay', 'Remux'],
  videoCodecs: ['HEVC', 'H.264'], hdrFormats: [], audioFormats: [], audioChannels: [], languages: [], releaseGroups: [],
  minimumSizeMb: 500, maximumSizeMb: 30000,
  rules: [
    { id: 'remux', attribute: 'Remux', kind: 'PREFERRED', score: 100 },
    { id: 'dv', attribute: 'Dolby Vision', kind: 'PREFERRED', score: 50 },
    { id: 'hevc', attribute: 'HEVC', kind: 'PREFERRED', score: 20 },
    { id: 'stereo', attribute: 'Stereo', kind: 'PREFERRED', score: -20 },
    { id: 'cam', attribute: 'CAM', kind: 'REJECTED', score: 0 },
  ],
  upgradeCutoffScore: 150, minimumScoreImprovement: 20,
  createdAt: '', updatedAt: '',
};

test('parses release attributes into canonical values', () => {
  const parsed = parseReleaseTitle('Movie.2026.1080p.BluRay.REMUX.DV.HEVC.TrueHD.Atmos.7.1-GROUP', 18000);
  assert.equal(parsed.resolution, '1080p');
  assert.equal(parsed.source, 'Remux');
  assert.equal(parsed.codec, 'HEVC');
  assert.deepEqual(parsed.hdr, ['Dolby Vision']);
  assert.equal(parsed.releaseGroup, 'GROUP');
});

test('rejects hard-rule violations before scoring selection', () => {
  const result = scoreRelease(profile, 'Movie.2026.720p.CAM.x264.Stereo-BAD', 1000);
  assert.equal(result.accepted, false);
  assert.ok(result.rejectionReasons.some((reason) => reason.includes('720p')));
  assert.ok(result.rejectionReasons.some((reason) => reason.includes('CAM')));
});

test('rejects releases with unknown audio or language when those are constrained', () => {
  const constrained = { ...profile, audioFormats: ['TrueHD'], languages: ['English'] };
  const result = scoreRelease(constrained, 'Movie.2026.1080p.WEB-DL.HEVC-GROUP', 1000);
  assert.equal(result.accepted, false);
  assert.ok(result.rejectionReasons.includes('Could not determine audio format'));
  assert.ok(result.rejectionReasons.includes('Could not determine language'));
});

test('uses deterministic tie breakers and blocks upgrade loops', () => {
  const candidates = [
    { id: 'b', title: 'Movie.1080p.WEB-DL.HEVC-GROUP', sizeMb: 2000 },
    { id: 'a', title: 'Movie.1080p.WEB-DL.HEVC-OTHER', sizeMb: 1500 },
  ];
  const selection = selectRelease(profile, candidates);
  assert.equal(selection.selected?.id, 'a');
  const upgrade = selectRelease(profile, candidates, 10);
  assert.equal(upgrade.selected, null);
  assert.equal(upgrade.upgradeAllowed, false);
  assert.match(upgrade.reason, /below the required/);
});
