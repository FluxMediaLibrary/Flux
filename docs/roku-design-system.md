# Flux website to Roku design system

This mapping is derived from `packages/frontend/app/globals.css`, the member library/detail/player components, and the existing Flux icon assets. Roku uses native SceneGraph nodes and platform fonts; CSS effects are translated into television-safe color, spacing, focus, and artwork rules.

## Core tokens

| Website token | Website value | Roku token and use |
| --- | --- | --- |
| `--bg` | `#0d0f12` | `backgroundColor`; full scene and player chrome. |
| `--bg-elev` | `#171a1f` | `surfaceColor`; cards, menus, and dialogs. |
| `--bg-elev-2` | `#21262d` | `raisedSurfaceColor`; selected panels and secondary buttons. |
| `--text` | `#f4f4f5` | `primaryTextColor`; headings and focused labels. |
| `--text-muted` | white at 66% | `secondaryTextColor` approximated as `#aaa9aa`. |
| `--text-dim` | white at 42% | `tertiaryTextColor` approximated as `#6b6b6c`. |
| `--accent` | `#3b82f6` | `accentColor`; primary action and progress. Server branding may override it after validation. |
| `--accent-2` | `#60a5fa` | `focusColor`; focused borders and active metadata. |
| `--ok` | `#22c55e` | Success/watched state, always paired with a label or icon. |
| `--warn` | `#f59e0b` | Warning state. |
| `--danger` | `#ef4444` | Destructive/error state. |
| `--radius` | 12 px | 12 design pixels at 1080p for panels. |
| `--radius-sm` | 8 px | 8 design pixels for controls. |
| `--shadow` | black 35%, 12/32 | Prefer border plus modest elevation; avoid expensive live blur. |

Flux's admin console has a separate amber-accent palette. It is not the member-client identity and should not drive Roku.

## Resolution, safe area, and scale

The design canvas is 1920 x 1080. All authored geometry uses that coordinate space and SceneGraph scales to 1280 x 720. Essential focusable content stays inside approximately 72 px horizontal and 48 px vertical margins on the 1080p canvas. Player controls use a slightly larger bottom inset.

Minimum television text sizes at 1080p:

| Role | Size | Weight/use |
| --- | --- | --- |
| Hero title | 58-68 px | Bold, maximum two lines. |
| Screen title | 42-48 px | Bold. |
| Row title | 28-32 px | Semibold. |
| Card title | 23-26 px | Semibold; reveal on focus where space is tight. |
| Body/description | 24-28 px | Regular, maximum 4-5 lines on details. |
| Metadata | 21-24 px | Regular, high contrast. |
| Button | 25-28 px | Semibold. |
| Error/helper | 22-26 px | Plain language. |

Use Roku system fonts for reliability and memory efficiency. The website stack (`Inter`, system UI, Segoe UI, Roboto, Helvetica, Arial) establishes the intended neutral sans-serif tone but does not justify bundling an unlicensed font.

## Artwork and layout

Website poster cards use a 2:3 aspect ratio. Roku poster cards use 240 x 360 at 1080p for primary rows, with smaller variants only when a screen needs more density. Backdrops and episode stills use 16:9. The website currently requests TMDb `w342` posters, `w1280` backdrops, `w300` episode stills, and `w185` profile/cast imagery. The Roku backend contract should expose fit-for-purpose URLs so BrightScript does not encode TMDb rules.

The detail layout maps to:

- Full-bleed backdrop on the upper/right area.
- Opaque-to-transparent left and bottom gradients rendered as static gradient assets or SceneGraph rectangles, not live blur.
- Title, metadata, actions, and overview anchored on the left.
- Seasons and episodes below the hero in horizontally or vertically navigable groups with explicit focus neighbors.

The home layout maps to one hero plus server-ordered rows. Continue Watching uses landscape cards with a 6-8 px progress rail. Movies and shows use posters. Episodes use landscape stills. Unfocused cards show art and minimal labels; focus reveals title and useful metadata.

## Focus and interaction states

Every focusable Roku component has these states:

| State | Treatment |
| --- | --- |
| Default | Normal art/surface, primary or secondary text. |
| Focused | 4 px `focusColor` border, 1.04-1.06 scale, brighter art, visible title/metadata. |
| Pressed | Brief 0.98 scale or darker surface; no delayed action. |
| Disabled | 45-55% opacity plus disabled wording where needed. |
| Loading | Stable geometry with low-cost pulse or spinner; no focus capture. |

The website primarily uses hover, outline, brightness, and small scale changes. Roku must make focus more explicit because a remote user cannot infer cursor position. Scale never changes the logical layout bounds enough to collide with adjacent cards. Animations target 120-180 ms and honor a reduced-motion application preference if exposed.

## Component translation

| Website surface | Roku component |
| --- | --- |
| Navbar/tabs | Persistent left sidebar with Home, Movies, Shows, optional Requests, Search, Settings. |
| Home rails | `ContentRow` with poster, landscape, or episode card renderer. |
| Cinematic detail hero | `HeroBanner` plus native buttons and metadata. |
| PosterCard | `PosterCard`; same 2:3 ratio and progress/watched badges. |
| Search overlay | Dedicated Search screen using Roku keyboard input and 300 ms debounce. |
| Profile picker | Large avatar grid with name labels and deterministic D-pad neighbors. |
| Web modal | Centered native dialog, focus trapped within dialog and restored on close. |
| Web player chrome | Native `Video` node plus Flux overlays for metadata, tracks, skip, Up Next, and errors. |

## Loading, empty, dialog, and error states

The website uses a blue ring spinner, fixed-geometry loading surfaces, centered empty messages, red error panels, retry actions, and dark modal cards. Roku retains those semantics:

- A row failure shows an inline error tile and Retry without removing other rows.
- A missing image uses branded neutral art without retry loops.
- An empty library or search gives a title, short explanation, and one relevant action.
- Playback errors replace indefinite buffering after the configured timeout.
- Destructive server/account actions use confirmation dialogs with Cancel initially focused.

## Branding rules

Bundled Flux branding is the safe fallback. Remote branding may change display name, logo URL, accent, and background only after bootstrap response validation. Colors must pass contrast checks and fall back to bundled tokens if invalid. Remote configuration cannot supply SceneGraph, BrightScript, arbitrary asset paths, or executable behavior.

