# Pip texture repair validation · 2026-11-03

Implementation and local validation are complete. **Verification of the repaired public release is
pending platform publication.** This is worker evidence, not independent certification. Physical
phones and real browser-AI inference were not tested.

The existing warm cream game, all five owner-authored growth meshes and gameplay were preserved.
The visual idea remains a golden 3D companion on a quiet stage with direct petting and feeding.
No redesign, wallet, transaction, service, subscription or owner infrastructure change was added.

## Root cause

The defect was reproduced against **https://pip-squeekchain-hamster-com-edf1.imd.site/** with normal
TLS in fresh Chromium 145, independently of localhost. [Public screenshot](screenshots/public-before.jpg),
[actual response headers](public-response.json) and [repeatable browser evidence](public-reproduction.json)
record the following:

1. HTML and the actual Tiny bean GLB both returned HTTP 200. The model's MIME type was
   `model/gltf-binary`; its SHA-256 was
   `7a93e168ecd2a958c7e145dadfc1479e37d538d6e07ed7adc9bf65e42e5e925c`, matching the accepted
   original asset. The installed mesh had 22,523 positions and authored normals. Meshopt decoding
   and delivery of the renderer/geometry therefore worked.
2. The HTML response allowed `img-src 'self' data: blob: https:` but specified
   `connect-src 'self' https: wss:`. The same policy was returned on the GLB. Cache-Control was
   `public, max-age=60`, with ETags and `X-Content-Type-Options: nosniff`.
3. The console stated: “Connecting to 'blob:https://pip-squeekchain-hamster-com-edf1.imd.site/6ddc942b-f842-4292-b70f-89f9c464162b'
   violates the following Content Security Policy directive: \"connect-src 'self' https: wss:\".
   The action has been blocked.” Three blocked fetches were followed by three
   `THREE.GLTFLoader: Couldn't load texture blob:…` errors. Browser policy-violation events
   independently identified `connect-src` and `blob`.
4. All three embedded images had valid WebP payloads. Passing their actual GLB buffer slices
   directly into `createImageBitmap(new Blob(...))` decoded all three at **1024×1024 on the public
   page**, under the same policy, without a URL fetch. Original image names ended in `.jpg`/`.png`,
   but their declared MIME and RIFF/WEBP bytes correctly identified WebP. Bad encoding or missing
   image bytes were not the cause.
5. Three.js **0.170.0** uses `ImageBitmapLoader` on modern Chromium. `GLTFLoader.loadImageSource`
   turns embedded bufferViews into object URLs; `ImageBitmapLoader` calls `fetch` on those URLs.
   That uses **connect-src**, even though img-src allows blob images. `GLTFLoader.loadTextureImage`
   catches rejection and returns null. The old scene called `onLoad(true)` anyway. Inspection of
   the actual public mesh found **map, normalMap, roughnessMap and metalnessMap all absent** and
   no loading/error message. This explains both the grey appearance and the misleading ready state.

This identifies the loader/policy mismatch and swallowed texture failures with direct evidence.
It does not attribute the failure to CSP merely because a CSP header exists. No policy was relaxed
and certificate verification was never disabled. The original export had no missing renderer CDN:
Three.js, GLTFLoader and MeshoptDecoder were bundled together, as they still are.

## Repair and files changed

| Source / assets | Implemented change |
| --- | --- |
| `public/models/*.glb`, fifteen sibling `*.webp` files | Extracted existing embedded images into relative URLs and removed their binary prefixes. Kept geometry, normals, UVs, compressed image bytes and material definitions. All corresponding files are in `dist/models/`. |
| `scripts/externalize-textures.mjs:16` | Dependency-free, controlled-layout GLB conversion; idempotent for the delivered externalized files; refuses unfamiliar layouts. |
| `scripts/compress-models.mjs` | Future regeneration ends with externalization, preventing the same embedded-image regression. |
| `src/scene/modelIntegrity.ts:6` | Checks every mesh/material for decoded colour, normal, roughness and metalness images, correct colour spaces, UVs, authored normals and smooth PBR materials. A mesh alone cannot pass. |
| `src/scene/PetScene.ts:176` | Request-specific loader/manager; rejects asset failures before installation, hides pending/failed models, isolates stale loads and disposes replaced models/ImageBitmaps. Existing shader deformation and lighting remain. |
| `src/ui/Stage.tsx:139`, `src/i18n.ts:105` | Explicit loading/ok/failed state, aria-busy, persistent bilingual error with Retry, snacks disabled until validation succeeds. Chinese error is at `src/i18n.ts:342`. |
| `src/App.tsx:129`, `src/App.tsx:522` | Refuses feeding before scene readiness; revision query avoids reuse of an old embedded GLB from the browser's 60-second cache during rollout. |
| `tests/modelIntegrity.test.ts`, `tests/modelAssets.test.mjs` | Seventeen readiness/colour-space/normal tests and five actual-asset integrity tests. |
| `scripts/check-textures.mjs`, `scripts/publication-policy.mjs` | Real browser material/image/framebuffer checks under the observed publication CSP, error injection, retry, previews, save isolation and post-publication verification. |
| `scripts/check-export.mjs`, README, DESIGN, `docs/` | Complete export inventory, repeatable commands, final design documentation, labelled evidence and explicit publication status. |

No existing package manifest, lockfile, Vite/TypeScript build configuration, chain configuration,
AI implementation, game engine/save rules, animation poses, audio clips or other project was changed.
The root package manifest and lockfile remain delivered unchanged. No submodule or dependency
archive is included.

## Artwork and normal preservation

The authorised reference ZIP was downloaded read-only and its SHA-256 verified as
`2c852405d0f488d75aa34841ba672772729ee3282206d8235432a8f553fc9144`.
Its five source meshes have the same named authored materials and matching texture atlases.
[Reference comparison](reference-comparison.json) records decoded RGB comparisons after resizing
those larger source images to 1024: base-colour PSNR **39.58–40.32 dB**, normal-map PSNR
**45.86–46.63 dB**. The accepted earlier export already used resized lossy WebP textures; this
repair does not claim those are byte-identical to the larger reference images.

Instead of recompressing artwork unnecessarily, this repair retains **every existing compressed
image and Meshopt payload byte-for-byte**. [Integrity fingerprints](texture-integrity.json) were
taken before extraction from the accepted commit. Five tests verify all fifteen image hashes,
all twenty compressed geometry blocks (including OCTAHEDRAL normals), material definitions,
counts, strides and compression modes. The existing 14-bit positions / 12-bit normals and UVs
are unchanged. No normals were recalculated and no generic or grey substitute model was added.
Base-colour maps are sRGB; normal/roughness/metalness maps are `NoColorSpace` data. Existing
sRGB output, ACES filmic mapping, exposure 1.05 and warm scene lighting are preserved.

## Commands and actual results

A clean `npm ci --cache /tmp/pip-npm-cache --no-audit --no-fund` installed the unchanged lockfile
successfully (120 packages). Tools were Node **24.22.1**, npm **11.19.1**, TypeScript **5.6.3**,
Vite **5.4.21**, Vitest **2.1.9** and external Playwright **1.58.2**.

| Command | Actual result |
| --- | --- |
| `npm run build` | Exit 0; typecheck + Vite, 476 modules, complete `dist/`. Existing nonfatal >900 kB app-chunk warning remains. |
| `npm run typecheck` | Exit 0 (`tsc --noEmit`). |
| `npm test` | Exit 0; **60/60**, five suites: original 43 plus 17 material-readiness tests. |
| `node --test tests/modelAssets.test.mjs` | Exit 0; **5/5** actual asset/payload integrity tests. |
| `SHOTS=docs/screenshots node scripts/e2e.mjs` | Exit 0; **48/48** Chromium gameplay and responsive checks, with publication CSP. [Output](e2e-results.txt). |
| `SHOTS=docs/screenshots REPORT=docs/texture-results.json node scripts/check-textures.mjs` | Exit 0; **98/98** across fresh Chromium **145.0.7632.6** and WebKit **26.0**. [Structured observations](texture-results.json). |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline` | Exit 0; **16/16** on the final export at 320, 390, 1440 and reduced motion. [Probe output](design-probe.json). |
| `node scripts/check-export.mjs` | Exit 0; **37** complete export files, **33** public assets matched byte-for-byte, five GLBs, fifteen images, eleven audio clips, relative URLs. [All hashes](export-integrity.json). |
| `node scripts/check-textures.mjs --url https://pip-squeekchain-hamster-com-edf1.imd.site/ --legacy --browser chromium` | Exit 0; **4/4** public reproduction, direct embedded-image decoding and policy observations. Normal TLS 1.3; no insecure flags. |
| Same public URL without `--legacy`, Chromium | Correctly refused the previous HTML: **canonical URL serves this export = false**. This is evidence publication is pending, not a repaired-public pass. |
| `node scripts/measure-delivery.mjs` / `git diff --check` | Exit 0; final byte inventory in [delivery-sizes.json](delivery-sizes.json), below 8,388,608 bytes; no whitespace errors. |

For browser commands, `PLAYWRIGHT_MODULE` / `IMD_PLAYWRIGHT` pointed to the external Playwright
installation and `PLAYWRIGHT_BROWSERS_PATH` to its temporary browser directory. Chromium used
SwiftShader. WebKit used Mesa software WebGL2. Missing Linux libraries were downloaded/extracted
under `/tmp`; the temporary WebKit launcher was adjusted only to preserve their library search
path. `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` skipped its ldconfig-based dependency
preflight because those libraries were not installed system-wide; actual WebKit rendering and all
material/pixel/interaction tests ran. Mesa/cache paths were temporary. This does not establish
hardware-GPU performance. A separate optional WebKit HTTPS probe failed with the machine's
network/TLS setup (“TLS support is not available”, then “WebKit encountered an internal error”);
public reproduction is therefore claimed only for Chromium. No certificate bypass was attempted.

Screenshots were JPEG-optimized at quality 66 with MozJPEG to fit the submission limit, retaining
all requested full-size labelled captures and all runtime assets. Their pixel dimensions are
unchanged. No source/runtime artwork was downsampled for packaging.

## Browser regression coverage

The texture suite serves the **exact production export at `/preview/`** with the actual public CSP
and nosniff header. Both browser contexts start without saved visitor data; no persistent visitor
profile or real save is opened. The normal path requests fifteen relative WebP files successfully,
with no relevant texture/decode/CSP/asset failures in either engine.

For **each of all five stages in each engine**, it checks four decoded maps at 1024×1024,
material colour spaces, normals/vertex counts, flatShading=false, golden and dark pixels in the
actual atlas **and in a freshly rendered WebGL framebuffer**, plus the expected stage label.
These checks would fail on the original grey mesh even though its canvas and geometry exist.
Labelled screenshots were visually inspected for golden/orange fur, white muzzle/belly, pink ears,
dark eyes and smooth fur shading: [all stage captures](screenshots/README.md).

Both engines also exercised rapid switching, preview save bytes remaining identical, returning
to My Pip, direct feet petting, drag turning and actual snack drag/drop to the animated mouth.
Material maps remain decoded and the installed smooth normal attribute/material remain unchanged
while petting and nibbling. Phone-width **390×844** and desktop **1440×900** captures show Pip and
its main actions; Chromium additionally checks 320×640 and 768×1024. There is no page overflow.

Separate fresh contexts deliberately receive corrupt base-colour, normal and packed RM image
responses, plus an HTTP 404 base-colour response. Each becomes **failed**, never ready, and cannot
feed. English and Traditional Chinese messages explain Retry; keyboard Enter retries successfully
with full maps and rendered colour, preserving save bytes. The Chinese retry focus ring was
inspected in both browsers. Intentional failure injections are separate from the clean-load error
assertions, so they are not hidden from a falsely empty error list.

The existing 48-check suite covers keyboard tap/hold/stroke/triple-tap, feet raycasts, feeding
acceptance/rejection, nibbling locks, failed-save refusal, sleep, abandoned games, bilingual event
cards, invalid backups and responsive placement. Unit suites cover elapsed growth, caps/cooldowns,
save validation, chat lifecycle and chain monitoring. Both games, twelve reactions, audio, AI and
read-only chain monitoring remain in source; no feature was removed to save bytes. End-to-end wins
in both games, all twelve full animation sequences and audio listening were not newly exercised.

## Better Interface review

Applied the pinned guide's workflow and core principles in all six domains while implementing,
then inspected the finished export. Established tokens, typography, navigation and composition
were preserved. Final implemented values and new load states are in [DESIGN.md](../DESIGN.md).

| Domain | Coverage and applicable findings/fixes | Limits |
| --- | --- | --- |
| Accessibility — Checked | `Stage.tsx:139` exposes loading state; existing polite status now announces real texture failures. Native 44px Retry, keyboard activation and 3px focus ring were exercised. Snacks are disabled until safe to feed. Existing keyboard gesture path and reduced-motion CSS were checked. | No screen-reader session, physical touchscreen, native 200% zoom or full WCAG audit. |
| Layout — Checked | Product, modes, meters and snacks are on the first 390 screen; 320/390/768/1440 regression screenshots inspected. Chinese error wraps without clipping. No probe overflow/overlap failures. | No RTL requirement; browser-native zoom untested. |
| Writing — Checked | `i18n.ts:105,342` now names model/fur-texture loading, gives a connection/retry step and preserves the established English / Traditional Chinese vocabulary. No technical stack detail added to the game flow. | No native-language editorial review. |
| Typography — Checked | Existing five-token scale, system fallback stack and 400/600 weights retained; normal casing and spacing. Error and button text stay readable in both locales. Probe: four first-screen sizes including one-offs, one family, two weights. | Platform fonts vary; no new font or exhaustive font-loading audit. |
| Colors — Checked | All five authored colour atlases and data-map colour spaces verified in both engines; rendered golden/dark pixels and screenshots inspected. Probe's measured solid-background text pairs pass 4.5:1 / 3:1 thresholds. | Probe excludes 26 text boxes over canvas/gradients; no claim of measured contrast for every translucent chip or image background. No dark theme exists. |
| UI — Checked | Persistent actionable failure replaces silent grey readiness; Retry returns to the fully textured state without moving unrelated content. Existing flat surfaces, radii, icons and motion retained. Probe **16/16**, zero unresolved first-screen findings. | No slowed Animations-panel or exhaustive hover-state audit; hardware performance untested. |

High finding 1: `PetScene.ts:176` previously declared readiness after GLTFLoader swallowed image
errors. Fixed with external images, request-specific failure tracking and `modelIntegrity.ts:6`;
98-check recheck passes. High finding 2: `Stage.tsx:142` could disappear over an untextured model;
real failed state, bilingual recovery and disabled feeding now persist until a validated load.
Rollout correction: `App.tsx:522` avoids cached embedded-model URLs. No unrelated design finding
was used to widen the repair. Metadata (title, favicon, description, og:title and og:image) remains
present and the referenced image/favicon are part of the complete export.

## Sizes and publication limits

Raw file bytes, not compressed transfer or Git pack sizes:

| Runtime/export group | Bytes |
| --- | ---: |
| Complete `dist/`, 37 files | **3,411,153** |
| Bundled app JS (Three.js, GLTFLoader, MeshoptDecoder, React and game) | 911,401 |
| Local chat worker entry | 1,986 |
| CSS | 12,277 |
| Five GLB containers + compressed geometry | 1,267,000 |
| Fifteen external WebP images | 394,162 |
| Eleven original audio clips | 757,273 |
| HTML, favicon and OG image | 67,054 |
| Source-side `public/` assets, retained for rebuilds | 2,484,287 |

| Stage | GLB bytes | GLB + its three WebPs |
| --- | ---: | ---: |
| Tiny bean | 255,788 | 329,454 |
| Milk mochi | 246,944 | 312,560 |
| Curious baby | 255,888 | 328,374 |
| Lively youngster | 252,084 | 336,610 |
| Little guardian | 256,296 | 354,164 |

[delivery-sizes.json](delivery-sizes.json) counts the **entire working submission**, including
source, unchanged manifest/lockfile, all public assets, complete export, tests, licenses, reports
and required screenshots, conservatively against **8 MiB**. It has positive headroom. No runtime
asset or feature was removed to meet it. No nested node_modules, npm registry/cache, source ZIP,
Linux package archive or browser binary is submitted. No ignore file was changed. Rendering and
textures work without a network CDN; optional AI and live chain reads retain their existing network
requirements. No paid storage or service is needed to host this 3.25 MiB export.

## AI evidence and limitations

AI source and its two optional download paths are unchanged. Five chat tests use a scripted
MockWorker, not a real model: progress, streaming/done, Stop, cancellation, retries and stale-worker
isolation. Real WebGPU/WASM inference, weight downloads, cache reuse, output quality and IME
integration were **not tested**. Existing estimates remain approximately 360 MB for GPU and 620 MB
for WASM first downloads, from pinned jsDelivr runtime versions and Hugging Face weights. Those
optional remote runtimes/weights were never local rendering dependencies and were not removed in
this repair. The GPU model's upstream URL can follow main; not every transitive CDN import is pinned.

Chain code/addresses are unchanged and read-only. Local browser checks deliberately block RPC;
rehearsals remain labelled simulated and sources become unavailable. Monitor unit tests use
fixtures. No new live request, settlement, reorg, wallet signature or transaction was performed.
Audio files are byte-identical in the export; actual playback/listening was not tested. Physical
Android/iPhone, mobile Safari, hardware WebGPU/WebGL and low-memory-device behavior are **untested**.
WebKit here is a Linux engine check, not a physical iPhone test.

## Publication status and repeatable final check

**Canonical preview URL:** https://pip-squeekchain-hamster-com-edf1.imd.site/ . The project record
says the platform publishes the next version under the same name. No new hostname/CID has been
issued to this worker. At the final worker check, the canonical URL still returned the previous
CID `bafybeicz43dmpzk7fcgswq4bwbjkpng3s7d7psdbrkdgqctxpibtfdf4oy` and the old HTML, verified
under normal TLS. [Publication status](publication-status.json) records the old and repaired HTML
hashes. The repaired release's public appearance, dependency delivery and clean console/network
check are **pending**; the localhost pass is not substituted for them.

After platform publication, run from this exact source/export with ordinary Playwright browser
and system dependencies installed (see README):

```sh
PLAYWRIGHT_MODULE=/tmp/pip-check-tools/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/pip-check-browsers \
SHOTS=/tmp/pip-published-shots REPORT=/tmp/pip-published-results.json \
node scripts/check-textures.mjs --url https://pip-squeekchain-hamster-com-edf1.imd.site/
```

Use the actual new canonical URL if the platform supplies a different one. This check requires
HTTPS, keeps certificate validation on, uses fresh contexts, rejects stale HTML, switches all five
models, checks decoded maps and real frame pixels, exercises touch/turn/feed, detects relevant
CSP/network/texture errors and compares **every one of the 37 exported files** to this `dist/`.
Inspect the labelled screenshots; record the URL, CID, TLS information, file hashes and result.
Only then can repaired-public validation be marked passed. Nothing in this job publishes to the
owner's VPS/DNS, changes another game or submits a Genesis review.
