# Flux avatar assets

This directory is intentionally limited to locally bundled profile presets with
a known product-approved source:

- `flux-*.svg`: original generic Flux artwork. The creature symbols are adapted
  from Flux's earlier inline vector set; `flux-orbit.svg` is the safe default.
- `sin-*.svg`: original abstract symbols for Flux's Seven Sins collection.
- `*_zodiac_*.png`: the approved Flux zodiac collection, preserved unchanged.

Do not add downloaded character art, reaction stickers, photographs, franchise
marks, or media with unknown ownership. New bundled presets should be original
SVGs using simple shapes and must be registered in `shared/src/index.ts`.

Profile rows store preset ids, not filenames. The backend migration
`20260730143000_remove_unsafe_profile_avatars` maps retired bundled ids to
`flux-orbit` while leaving unknown values untouched so user-owned data is not
deleted. API serialization and the frontend image error handler provide a
second fallback for stale ids or missing files.
