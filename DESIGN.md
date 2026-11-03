# DESIGN.md · Pip

Implemented design of the Pip rebuild, extracted from `src/styles.css`, `src/ui/*.tsx`,
`src/App.tsx` and `src/scene/PetScene.ts`. Reuse these tokens and components for any new surface.

## Overview

A warm, soft, single-page companion game for casual visitors on phones first. The 3D hamster is
the product: the stage (canvas plus a thin layer of controls) comes first on every width, and
every other feature lives in one tabbed panel (Care, Play, Chat, Chain, Pip). Surfaces are flat
cream layers on a cream page; colour is reserved for the accent (actions, selection), the live
chain state (green) and simulated rehearsals (violet). Copy is short and sits beside the control
it explains.

## Colors

All tokens are CSS custom properties on `:root` in `src/styles.css`.

| Token | Value | Job |
| --- | --- | --- |
| `--bg` | `#f7efe3` | Page background, default button fill |
| `--surface` | `#fffaf3` | Panel, cards, quiet buttons, overlays on the stage (at 92–97% opacity) |
| `--sunk` | `#efe3d2` | Meter tracks |
| `--ink` | `#2b2118` | Primary text, badge background |
| `--muted` | `#65523f` | Secondary text, inactive tabs, hints |
| `--line` | `#e2d3bf` | Borders and dividers |
| `--accent` | `#b5501a` | Primary button, selected tab underline, meter fill, links, pressed segment |
| `--accent-ink` | `#ffffff` | Text on accent |
| `--accent-soft` | `#fbe3cf` | Pressed/checked buttons, local card tag |
| `--live` / `--live-soft` | `#1f6b45` / `#dcefe3` | Live chain status and live card |
| `--sim` / `--sim-soft` | `#6a4a9c` / `#ece4f7` | Simulated rehearsal tag and card edge |
| `--warn` | `#a3321f` | Errors, removed-by-reorg, failed loads |
| `--focus` | `#1a5fb4` | 3px focus ring on `:focus-visible` |

The stage background is a radial gradient `#fff8ee → #f3e3cc → #ead6b9` (`.stage`). The design
probe's resolved solid-background samples passed (lowest measured ratio 6.5:1 on the tagline).
It excluded 26 text boxes over canvas/gradients; those pairs are unmeasured, including translucent
stage chips. See [the review coverage](docs/VALIDATION.md#better-interface-review).

## Typography

- One family stack, `--font`: `ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, …, 'Noto Sans TC',
  'PingFang TC', 'Microsoft JhengHei', sans-serif`. No web fonts are bundled; the rendered face is
  the platform's rounded or system UI font, with a Traditional Chinese system fallback.
- Two weights: 400 body, 600 headings, buttons, labels, numbers.
- Five sizes: `--fs-1` 0.8125rem (hints, meta, chips), `--fs-2` 0.9375rem (body, buttons),
  `--fs-3` 1.0625rem (h3/h4), `--fs-4` 1.3125rem (h2), `--fs-5` 1.75rem (h1 "Pip").
- Line height 1.5 body, 1.1–1.25 headings. No letter-spacing changes, no all-caps labels.
- `.num` uses tabular numerals for meters, block numbers and counters.

## Layout

- Spacing scale `--s-1…--s-5` = 4, 8, 12, 16, 24 px; components use only these.
- `.layout` is one column with 12px gutters below 960px. At 960px and up it becomes a two-column
  grid: the stage (sticky) on the left, the panel 360–440px on the right.
- `.stage` height: `clamp(440px, 74svh, 760px)`; under 420px wide `clamp(420px, 68svh, 640px)`.
- Stage composition: `.stage-top` (mode switch, stage name, badge) and `.stage-bottom` (meters,
  snack tray) overlay the full-bleed canvas. `Stage.tsx` measures both and (1) passes the free band
  to `PetScene.setInsets`, which fits each growth mesh into that band with a view offset so feet and
  contact shadow sit above the meters on every width; (2) sets `--top-inset`/`--bottom-inset` so the
  floating card stack is bounded to the same band and scrolls instead of covering snacks.
- Under 420px the tagline hides, meter and tray padding tighten, snack buttons stack icon over label.
- Checked widths: 320, 390, 768, 1440 (no horizontal overflow).

## Elevation & Depth

Deliberately flat: no box shadows. Depth comes from tonal layers (`--bg` page → `--surface`
panel/cards → translucent `--surface` chips over the 3D stage) and 1px `--line` borders. Stacking
inside the stage: canvas 0, loading message 1, top/bottom controls 2, invitation 3, cards 4; the
sound panel is 20 in the header.

## Shapes

`--radius` 12px for panels, stage, cards, meter groups; `--radius-sm` 8px for buttons, snacks,
tiles; 999px pills for the mode switch, icon buttons, chips, tags and status labels; 6px for a few
small inner elements. Cards carry a 4px inline-start border in their kind colour.

## Components

| Component | Source | Notes |
| --- | --- | --- |
| `.btn`, `.btn-primary`, `.btn-quiet` | `styles.css` | 44px min height. Pressed/checked state uses `--accent-soft` + accent border. Disabled at 55% opacity. |
| `.icon-btn` | header | 40px pill: language, sound on/off, sound settings |
| `.seg` / `.seg-btn` | `Stage.tsx` | Pet/Turn switch with `aria-pressed` |
| `.bars` (`dl`) | `Stage.tsx` | Bond, energy, fullness meters with numeric value |
| `.snack` | `Stage.tsx` | Drag source and Enter-to-feed button; `.ghost` follows the pointer, `.ghost-ok` when droppable |
| `.cards` / `.card-{local,live,simulated}` | `Stage.tsx` | Up to 3 at once, auto-dismiss 5 s (local) / 9 s; tag, network label, title, why, confirmations, tx link |
| `.tabs` / `.tab` | `App.tsx` | ARIA tablist; selected tab has a 3px accent underline |
| `.tile` | `Games.tsx` | Memory and seed-hunt grid cells (`.grid-4`) |
| `.source`, `.status-*`, `.facts` | `ChainPanel.tsx` | Chain source card; stale data is struck through and muted |
| `.sound-panel`, `.slider` | header | Music/effects sliders, loading/cancel/retry |
| Chat log/composer | `ChatPanel.tsx` | Streaming lines, Stop/Clear/Retry, IME-safe Enter |

Icons are inline SVG in `src/ui/icons.tsx` (food, shapes, sound), `aria-hidden` beside text.

## Motion

Card entry is a 0.25s fade/slide; buttons transition colour only. The 3D clips scale to 35%
amplitude, with no hops/spins, and idle fidgets stop under `prefers-reduced-motion`; CSS animations
and transitions are disabled by the same media query.

## Do / don't

- Do put new features in a tab of the panel, not above the stage.
- Do keep chain colours semantic: green only for verified live data, violet only for simulations.
- Don't place new overlays over `.stage-bottom`; anything floating on the stage must respect
  `--top-inset`/`--bottom-inset`.
- Don't add a sixth type size or a second family.
