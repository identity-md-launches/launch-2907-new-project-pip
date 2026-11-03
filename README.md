# Pip · Squeekchain hamster companion

The Pip hamster game as a static Vite + React + TypeScript site, continued from
`b6aee41c5919311d4fa19a6a0cba9f961497fe9f`. This revision repairs the published texture failure.
Pip is a 3D hamster (five authored growth meshes from the reference build) that visitors pet,
feed, play with and grow over real time. It also offers free on-device AI chat and read-only
Squeekchain / IMD chain telemetry. English by default, Traditional Chinese throughout.

The committed `dist/` is the static export. It uses relative asset URLs (`base: './'`) so it
works from a gateway subpath or an ENS name. No server, backend, wallet or paid service.

## Install, preview, rebuild

Requires Node 20+ (this revision checked with Node 24.22.1, npm 11.19.1).

```sh
npm ci                 # install exact versions from package-lock.json
npm run dev            # development server
npm run build          # tsc --noEmit, then vite build -> dist/
npm run preview        # serve dist/ at http://localhost:4380
npm run typecheck      # tsc --noEmit only
npm test               # vitest unit suites (tests/*.test.ts)
node --test tests/modelAssets.test.mjs # byte integrity of all five authored models/textures
node scripts/check-export.mjs         # complete export, relative textures, asset hashes
npm run e2e            # Chromium checks against dist/ (needs Playwright, see below)
node scripts/check-textures.mjs        # Chromium + WebKit material/pixel/error/retry checks
```

`npm run e2e` serves `dist/` locally and drives Chromium through Playwright. Playwright is not a
site dependency; install the check tools outside the repository:

```sh
npm install --prefix /tmp/pip-check-tools playwright@1.58.2
PLAYWRIGHT_BROWSERS_PATH=/tmp/pip-check-browsers /tmp/pip-check-tools/node_modules/.bin/playwright install chromium webkit
PLAYWRIGHT_MODULE=/tmp/pip-check-tools/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/pip-check-browsers npm run e2e
PLAYWRIGHT_MODULE=/tmp/pip-check-tools/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/pip-check-browsers node scripts/check-textures.mjs
```

Or point `PLAYWRIGHT_MODULE` at an existing `playwright/index.mjs`. WebKit also needs Playwright's
documented Linux system libraries (`playwright install-deps chromium webkit` on a machine with
system-install permission). Neither browser is a website dependency. `SHOTS=docs/screenshots`
captures labelled screenshots; `REPORT=/tmp/texture-results.json` records the texture check.
The browser scripts own and close their temporary HTTP server and use fresh, disposable contexts.
Texture checks serve the exact `dist/` at `/preview/` with the observed public CSP, including its
restriction on `blob:` fetches. Optional AI/RPC traffic is blocked during local regression runs.

## Project layout

| Path | What it holds |
| --- | --- |
| `src/game/` | Pure game rules (`engine.ts`) and the isolated save namespace (`save.ts`) |
| `src/scene/` | three.js scene, raycast body parts, gestures, procedural clips |
| `src/chat/` | Browser-only chat worker and lifecycle client |
| `src/chain/` | Read-only RPC client, event decoding, reorg-aware monitor |
| `src/audio/` | User-enabled sound with separate music/effects volumes |
| `src/ui/` | Stage, games, chat and chain panels |
| `public/models/` | Five authored Meshopt GLBs and fifteen relative WebP texture files |
| `public/audio/` | Music and effect clips |
| `tests/` | Vitest suites and recorded public receipts used as fixtures |
| `scripts/e2e.mjs` | Browser interaction checks against the export |
| `scripts/check-textures.mjs` | Both-browser material, decoded-image and rendered-pixel checks; publication recheck |
| `scripts/externalize-textures.mjs` | Lossless extraction of the existing embedded image payloads |
| `docs/texture-integrity.json` | Original compressed geometry/image fingerprints, checked by Node tests |
| [docs/VALIDATION.md](docs/VALIDATION.md) | Test results, Better Interface review, sizes, limitations |
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
pinned jsDelivr entry URLs and the weights from Hugging Face, then the browser caches them. The
WebLLM default GPU model URL follows upstream `main`; not every transitive CDN import is pinned.
Runtime availability probes and mocked lifecycle checks do **not** establish real inference. See
[the separate AI evidence and limitations](docs/VALIDATION.md#ai-evidence-and-limitations). They are
not bundled into `dist/`: the WASM runtime alone is 36,378,941 bytes in the reference ZIP, and
the weights are hundreds of MB, far beyond the 8 MiB submission budget. See
`docs/VALIDATION.md` § Sizes. Nothing runs on a server and no API key exists.

## Hosting

Hosting is not part of this repository's work. The platform pins the committed `dist/` after
the job completes; this repository does not publish, does not touch the owner's existing site,
DNS or VPS, and does not change any earlier Genesis submission. See `docs/VALIDATION.md` for
what the platform must still confirm (URL, TLS).

Canonical preview URL to recheck after the platform publishes this revision:
**https://pip-squeekchain-hamster-com-edf1.imd.site/** (same project name).
At the worker's last check it still served the previous grey-texture export. Publication of the
repair and verification of the repaired canonical URL are **pending**. No new URL or CID has been
issued to this worker, and no publish command was run.

```sh
# After publication, use the actual canonical URL returned by the platform if it differs.
PLAYWRIGHT_MODULE=/tmp/pip-check-tools/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/pip-check-browsers \
SHOTS=/tmp/pip-published-shots REPORT=/tmp/pip-published-results.json \
node scripts/check-textures.mjs --url https://pip-squeekchain-hamster-com-edf1.imd.site/
```

This uses normal HTTPS validation, confirms the HTML and every exported file match `dist/`,
then inspects all five material maps and rendered colours and exercises petting, turning and
drag feeding in both engines. It fails early if the previous export is still being served.
Review the labelled screenshots as well as the JSON. Never infer a publication pass from local
results. `--browser chromium` or `--browser webkit` limits a diagnostic run to one engine.

## Texture repair and asset pipeline

The public failure was reproduced in Chromium: GLB and geometry loaded, but
`ImageBitmapLoader` fetched embedded textures through `blob:` URLs. The host permits those in
`img-src` but blocks them in `connect-src`. `GLTFLoader` then swallowed texture failures and
returned a mesh with null maps. The same embedded WebP bytes decoded successfully when passed
directly to `createImageBitmap`; neither missing images nor a broken WebP codec caused the defect.
See [the evidence and root cause](docs/VALIDATION.md#root-cause).

The five GLBs now reference sibling `*-basecolor.webp`, `*-normal.webp` and `*-rm.webp` files.
Their original compressed image and geometry payloads are unchanged byte-for-byte. Base colour
stays sRGB; normal and roughness/metalness data maps stay linear. The existing smooth normals,
UVs, material definitions, shader deformations and lighting remain intact. The app requests GLBs
with `?textures=external-v1` to avoid a previously cached embedded GLB during rollout.

`requireTexturedModel` rejects missing/undecoded maps, wrong colour spaces and absent normals/UVs
before installation. Failed or pending loads do not enable feeding. The stage shows an English
or Traditional Chinese connection/retry message; Retry loads fresh assets without changing saves.
No hosting policy or certificate validation was weakened. Three.js, GLTFLoader and MeshoptDecoder
are local in the production JS; WebP decoding is native to the browser.

Normal builds use the committed assets and need no image tools. To extract another original
compressed GLB with the same controlled layout, run `node scripts/externalize-textures.mjs <dir>`.
It is idempotent for the delivered files and refuses unfamiliar binary layouts.

If deliberate regeneration from the authorised reference is needed later, verify the ZIP SHA-256
`2c852405d0f488d75aa34841ba672772729ee3282206d8235432a8f553fc9144` first. Extract its
`source/dist/assets/growth-web/` under `/tmp`, install the optional asset tools outside this repository,
and copy both pipeline scripts beside those tools so Node can resolve their imports:

```sh
npm install --prefix /tmp/pip-asset-tools @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp
cp scripts/compress-models.mjs scripts/externalize-textures.mjs /tmp/pip-asset-tools/
# Supply absolute input/output directories; this re-encodes assets and requires full review.
node /tmp/pip-asset-tools/compress-models.mjs /tmp/reference/source/dist/assets/growth-web /tmp/pip-regenerated-models
```

The compression script ends by externalizing textures. Intentional artwork regeneration requires
reviewing/updating the integrity manifest and rerunning material, pixel and interaction checks.
This repair did not require recompression or replacing the owner's models.

## Validation

Worker validation (2026-11-03): production build and typecheck pass; 60 Vitest tests plus five
asset-integrity tests pass; Chromium gameplay **48/48**, Chromium/WebKit texture checks **98/98**,
and the design probe **16/16**. These are local worker results. Real-model GPU/WASM
inference, physical phones and the repaired public preview remain untested. See
[the delivery report](docs/VALIDATION.md) and [screenshots](docs/screenshots/README.md).
Run `node scripts/measure-delivery.mjs` for current source/export/payload byte counts.
