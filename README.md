# Pip · Squeekchain hamster companion

A new, independent rebuild of the Pip hamster game as a static Vite + React + TypeScript site.
Pip is a 3D hamster (five authored growth meshes from the reference build) that visitors pet,
feed, play with and grow over real time. It also offers free on-device AI chat and read-only
Squeekchain / IMD chain telemetry. English by default, Traditional Chinese throughout.

The committed `dist/` is the static export. It uses relative asset URLs (`base: './'`) so it
works from a gateway subpath or an ENS name. No server, backend, wallet or paid service.

## Install, preview, rebuild

Requires Node 20+ (checked with Node 24.22, npm 11.19).

```sh
npm ci                 # install exact versions from package-lock.json
npm run dev            # development server
npm run build          # tsc --noEmit, then vite build -> dist/
npm run preview        # serve dist/ at http://localhost:4380
npm run typecheck      # tsc --noEmit only
npm test               # vitest unit suites (tests/*.test.ts)
npm run e2e            # Chromium checks against dist/ (needs Playwright, see below)
```

`npm run e2e` serves `dist/` locally and drives Chromium through Playwright. Playwright is not a
site dependency; provide it once with `npm i -D playwright && npx playwright install chromium`,
or point `PLAYWRIGHT_MODULE` at an existing `playwright/index.mjs`. `SHOTS=docs/screenshots npm run e2e`
also rewrites the screenshots in `docs/screenshots/`.

## Project layout

| Path | What it holds |
| --- | --- |
| `src/game/` | Pure game rules (`engine.ts`) and the isolated save namespace (`save.ts`) |
| `src/scene/` | three.js scene, raycast body parts, gestures, procedural clips |
| `src/chat/` | Browser-only chat worker and lifecycle client |
| `src/chain/` | Read-only RPC client, event decoding, reorg-aware monitor |
| `src/audio/` | User-enabled sound with separate music/effects volumes |
| `src/ui/` | Stage, games, chat and chain panels |
| `public/models/` | The five authored growth meshes (meshopt-compressed GLB) |
| `public/audio/` | Music and effect clips |
| `tests/` | Vitest suites and recorded public receipts used as fixtures |
| `scripts/e2e.mjs` | Browser interaction checks against the export |
| `docs/VALIDATION.md` | Test results, Better Interface review, sizes, limitations |
| `docs/screenshots/` | Screenshots taken by `scripts/e2e.mjs` |
| `docs/chain/` | Chain deployment provenance records |
| `licenses/` | Third-party licenses |

## How to play

- **Pet mode** – tap, stroke (drag across Pip), hold, or tap three times quickly. Head, cheek,
  nose, belly, paw and feet each respond differently. **Turn mode** – drag to turn Pip; it never
  counts as petting. Background clicks and cancelled drags never award anything.
- **Keyboard** – arrows turn Pip; 1–6 choose and tap a body part; H holds, S strokes and T plays
  the three-tap surprise on the chosen part. Buttons for the same actions are on the Care tab.
- **Snacks** – drag a snack to Pip's mouth (a ring shows when it is close) or focus it and press
  Enter. Pip will not eat while asleep, full (90%+), on a 45 s cooldown, eating, or during a game.
- **Growth** – real elapsed time only: 1, 3, 7 and 21 days. Offline time counts, capped at 7 days
  per absence. Bond is capped at 30 per day; touches pay at most every 20 s.
- **Saves** – stored under `pip-rebuild-save-v1`. The old site's `squeek-public-pet-v1` is only
  read, after an explicit confirmed import. Backups can be exported and restored; malformed
  backups are rejected without touching the current save.

## Browser AI

Inference runs in a Web Worker on the visitor's device. WebGPU uses WebLLM
(`@mlc-ai/web-llm@0.2.87`, `Qwen3-0.6B-q4f16_1-MLC`, about 360 MB first download); the explicit
WASM compatibility retry uses transformers.js (`@huggingface/transformers@3.7.6`,
`onnx-community/Qwen3-0.6B-ONNX` at a pinned revision, about 620 MB). Both runtimes come from
pinned jsDelivr URLs and the weights from Hugging Face, then the browser caches them. They are
not bundled into `dist/`: the WASM runtime alone is 36,378,941 bytes in the reference ZIP, and
the weights are hundreds of MB, far beyond the 8 MiB submission budget. See
`docs/VALIDATION.md` § Sizes. Nothing runs on a server and no API key exists.

## Hosting

Hosting is not part of this repository's work. The platform pins the committed `dist/` after
the job completes; this repository does not publish, does not touch the owner's existing site,
DNS or VPS, and does not change any earlier Genesis submission. See `docs/VALIDATION.md` for
what the platform must still confirm (URL, TLS).

## Validation

The latest run (2026-11-03): `npm run build` passes (typecheck + Vite), `npm test` 31/31,
`npm run e2e` 45/45, design probe 16/16. Details and limitations are in `docs/VALIDATION.md`.
