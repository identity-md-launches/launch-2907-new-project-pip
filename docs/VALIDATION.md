# Delivery validation · 2026-11-03

This revision preserves the accepted game and addresses the two reopened findings: missing
delivery evidence and unsafe backup timestamps. The scoped fixes are complete. This is a local
worker report, not independent certification of the entire original brief. Real-model inference,
physical devices and the platform's eventual deployed preview have not been validated.

## Reproduction and correction

| Finding | Evidence before the fix | Correction and recheck |
| --- | --- | --- |
| `7e6912aa7007721fff1d213393a6a7d2e8ca5175f230df95dcd1bb0473e8021f` · high · `README.md:44` in the reviewed version | The README referenced `docs/VALIDATION.md` and `docs/screenshots/`; neither existed. | Added this report, actual screenshots, check summaries and byte inventory. Updated the README to the results actually obtained in this revision. |
| `bcbfd8aa3a649391b628af8cf844d5872d296bcca27582846dffdcd5e62f7bc7` · medium · `src/game/engine.ts:309` | Chromium at 390×844: uploaded a current backup with only `memories[0].at = 1e20`. The saved timestamp became `1e20`, `#root.innerHTML.length` became **0**, and a page error reported `RangeError: Invalid time value`. | One timestamp predicate now accepts only finite values in **0…8,640,000,000,000,000 ms**, the nonnegative portion of JavaScript's Date range. Applied to memories, creation/update/settlement timestamps, nullable action timestamps and cooldowns. `parseBackup` rejects invalid values before `doRestore` calls `commit`. Browser tests verify the existing saved string remains byte-for-byte unchanged, the error reads “That file is not a Pip backup.”, and Memories remains usable after reload. |

Before the engine change, the expanded save suite had **8 failing / 26** tests, reproducing the
range gap. Afterwards all 26 passed, including the first invalid millisecond above the Date limit,
the exact `1e20` report, negative memory time, other saved timestamp fields, and acceptance of
memory times **0** and **8,640,000,000,000,000**. Existing valid saves and the save namespace remain
compatible. The five meshes, game interface and integrations were not rebuilt in this revision.

## Commands and actual results

Dependencies were installed from the unchanged lockfile in a temporary mirror of the tracked
source, outside the repository. The final production `dist/` was copied back unchanged and browser
checks ran against that export in this repository. No dependency/cache directories are delivered.
Tool versions: Node **24.21.0**, npm **11.19.0**, TypeScript **5.6.3**, Vite **5.4.21**, Vitest
**2.1.9**, Playwright **1.58.2**, Chromium **145.0.7632.6**. Chromium used SwiftShader, a software
WebGL renderer; this is not evidence of hardware GPU or phone performance.

| Command | Actual outcome | Scope |
| --- | --- | --- |
| `npm ci` | Exit 0; 120 packages installed | Reproducible lockfile installation in the temporary source mirror |
| `npm run typecheck` | Exit 0 | `tsc --noEmit` |
| `npm test` | Exit 0; **43/43**, 4 suites | Engine/save 26, gestures 5, chat lifecycle 5, chain monitor 7 |
| `npm run build` | Exit 0; 475 modules transformed | Typecheck plus Vite production export; the app chunk exceeds the configured 900 kB warning threshold. This nonfatal size warning remains. |
| `SHOTS=docs/screenshots npm run e2e` | Exit 0; **48/48** | Fresh Chromium contexts; all external requests deliberately blocked; real local WebGL canvas and GLB assets |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline` | Exit 0; **16/16** | Initial Care screen at 320, 390 and 1440; CSS reduced-motion check. The pinned probe is an assignment input, removed before submission. |
| `node scripts/measure-delivery.mjs` | Exit 0; below **8,388,608 bytes** | Raw file inventory of the proposed submission, including source, export and evidence; see [exact final counts](delivery-sizes.json) |
| `git diff --check` | Exit 0 | Whitespace/patch integrity |

For the browser commands, `PLAYWRIGHT_MODULE` and `IMD_PLAYWRIGHT` pointed to the external
Playwright installation; `PLAYWRIGHT_BROWSERS_PATH` pointed to its external browser directory.
See the README for repeatable installation commands. The browser script owns its local HTTP
server and closes it and the browser when finished. It does not publish anything.

The complete passing browser-check names and observations are retained in
[e2e-results.txt](e2e-results.txt); the measured probe outputs are in
[design-probe.json](design-probe.json). Neither establishes untested behavior.

## Interaction coverage and limits

| Area | Actually exercised | Limits |
| --- | --- | --- |
| Rendering and stages | All five local GLBs loaded in a real WebGL scene. Feet coordinates hit the canvas above the meters; no script errors or failed local resources in the responsive contexts. Model bytes in `public/` and `dist/` match. | Stage switching uses the explicitly labelled preview; actual multi-day passage is covered by deterministic engine tests, not waiting 21 days. No physical-device performance measurement. |
| Touch and turning | Browser: feet raycast response; keyboard nose tap, hold, stroke and three-tap surprise, with persisted surprise memory. Unit: tap, stroke, hold, triple tap, background rejection, cancelled/off-model drags, and turn-only behavior. | Gesture unit tests use synthetic hit tests. Physical touchscreen gestures and all six body regions with real touch hardware were not exercised. |
| Feeding | Browser: off-mouth rejection, accepted drop at the animated mouth socket, nearby hint, one saved meal, eat clip, cooldown refusal, sleep refusal, keyboard Enter, failed-save refusal, and the eating lock while the scene is hidden. Unit: full/asleep/cooldown/unknown-food rejection. | Fullness rejection is a unit check, not a separate browser screenshot. No visual assessment of every animation frame or all snack/stage combinations. |
| Priorities and repeated actions | Sleeping disables care; eating locks Nap until the clip ends. Leaving a memory round then starting seed hunt does not let an old callback unlock feeding. Repeated care cooldown, touch reward cap, elapsed growth and seven-day offline cap covered in engine tests. | The browser test starts/abandons games; it does not solve both games end-to-end or exhaustively test all possible interleavings. |
| Persistence | Null wish, `1e20` memory date and Date-limit+1 backups rejected with identical saved bytes. Reload and reopening Memories work. Save-write failure refuses eating/rewards. | Legacy import was source-reviewed, not newly exercised against the owner's actual old save. No cross-origin storage access is claimed. |
| Languages and layouts | English default; Traditional Chinese memory-card face, network line and simulated-event card. 320×640, 390×844, 768×1024 and 1440×900 have no horizontal page overflow and keep the model/feet on the first screen. Three simultaneous cards at 320 stay above snacks; their stack can scroll. | Viewport emulation is not a phone or native zoom test. The tab strip scrolls at 320. No native-language editorial review. |
| Chain data | Browser with RPC blocked: both sources visibly Unavailable; rehearsal cards labelled Simulated rehearsal, with network labels. Unit: stable identity, deduplication across re-inclusion, reorg removal, wrong emitter/chain refusal, stale/unavailable states, backoff and stopping an in-flight poll. | Chain unit tests use a scripted RPC and recorded receipt fixtures. No new live settlement/request, real reorg or reconnection was observed in this revision. No rehearsal is evidence of a live event, reward or payout. |
| Chat and sound | Chat state-machine tests below; source review of IME handling. User-enabled sound controls and loading logic reviewed in source. | No real inference, IME browser integration test, audio playback/listening, volume/ducking measurement or audio loading/cancellation test was performed in this revision. |

The screenshot [390-first-screen.jpg](screenshots/390-first-screen.jpg) was inspected: Pip, Pet/Turn,
the response to a direct touch, meters and snack actions are visible within 390×844. The [clean
390 view](screenshots/390.jpg) also shows the model and snacks without a floating response. Other
inspected screenshots include 320, 768 and 1440, Traditional Chinese, and the full rejected-restore
page. [Screenshot index](screenshots/README.md) identifies all captures and their states.

## AI evidence and limitations

**Mock lifecycle results:** the **five** tests in `tests/chat.test.ts` instantiate `ChatClient`
with a scripted `MockWorker`. They verify progress, streaming/done, Stop and late-token isolation,
Clear/Retry, replacement-worker isolation, explicit WASM backend retry, loading cancellation,
empty-input refusal and refusal while already generating. The “Squeak!” test tokens are fixtures,
not model output. These tests do not instantiate the real chat worker, download weights, compile
WASM or execute a language model. The browser e2e suite blocks external traffic and never starts
a model. The application's implementation uses the real runtime worker; there is no simulated
chat fallback in the delivered game.

**Real-model results:** **not run**, for either WebGPU or WASM. First-download completion,
real token streaming, actual model Stop responsiveness, model memory use, browser cache reuse,
quality and language behavior therefore remain **untested**. Hardware WebGPU, Safari/WebKit,
physical iPhone/Android and low-memory-device tests are also **untested**. Do not read the 43 unit
tests, 48 browser checks or successful CDN downloads as real-inference certification.

**Runtime availability and size probes:** HTTPS GETs with normal certificate validation (curl TLS
verification result 0) returned HTTP 200 for the two configured runtime entry modules, the ONNX
runtime entry and sampled WASM, and the WebLLM model library. Model file sizes below are from
Hugging Face's file metadata API, not downloaded weight files or a completed browser load.
No TLS bypass was used. Full external import-graph execution, CORS behavior in the worker and
end-to-end model loading remain unverified.

## Sizes

All local counts are raw file bytes, not gzipped transfers or Git pack sizes. The production export
is **3,409,761 bytes**. The [final inventory](delivery-sizes.json), regenerated by
`node scripts/measure-delivery.mjs`, includes the report and all screenshots in the payload total.

| Local runtime/export group | Bytes | Delivery |
| --- | ---: | --- |
| App JS (`index-CXoSYsvE.js`) | 909,531 | Bundled React, three.js, GLTFLoader, MeshoptDecoder and application code |
| Chat worker (`worker-CDgOTjHG.js`) | 1,986 | Local worker entry; imports the optional remote AI runtimes only on request |
| CSS (`index-CfeRa0Wv.css`) | 12,277 | Local stylesheet |
| Five growth meshes | 1,661,640 | All in both `public/models/` and `dist/models/`; no mesh changed in this revision |
| Eleven audio clips | 757,273 | All in both `public/audio/` and `dist/audio/` |
| Remaining export (HTML, favicon, OG image) | 67,054 | Local static files |

| Mesh filename | Bytes |
| --- | ---: |
| `01-tiny-bean.glb` | 329,556 |
| `02-milk-mochi.glb` | 312,664 |
| `03-curious-baby.glb` | 328,476 |
| `04-lively-youngster.glb` | 336,692 |
| `05-little-guardian.glb` | 354,252 |

The source-side `public/` assets total **2,484,765 bytes**, deliberately retained alongside the
export for rebuilding. `src/` totals **186,820 bytes**. Source, tests, manifests/lockfile,
configuration, licenses, static export and screenshots are all counted in the final inventory.
The inventory is conservative for the 8 MiB limit because it counts the complete working
submission's raw files, including both source/public assets and their exported copies.

| Optional external AI component | Observed bytes | Measurement and source |
| --- | ---: | --- |
| WebLLM 0.2.87 ESM entry | 6,175,660 | Downloaded [configured jsDelivr entry](https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.87/+esm) |
| Transformers.js 3.7.6 ESM entry | 490,343 | Downloaded [configured jsDelivr entry](https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm) |
| ONNX Runtime Web ESM entry | 395,093 | Downloaded [versioned transitive entry](https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/+esm) |
| ONNX SIMD threaded JSEP WASM sample | 21,596,019 | Downloaded [runtime asset](https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/ort-wasm-simd-threaded.jsep.wasm); not an exhaustive runtime inventory |
| WebLLM Qwen3 GPU model library | 6,561,594 | Downloaded [library used by the default model config](https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm) |
| Qwen3 GPU parameter shards (9 files) | 335,372,288 | Sum of shard sizes in [model root metadata](https://huggingface.co/api/models/mlc-ai/Qwen3-0.6B-q4f16_1-MLC/tree/main?recursive=false&expand=false); no weight download |
| Qwen3 ONNX `model_quantized.onnx` | 617,687,575 | q8 file in [pinned model revision metadata](https://huggingface.co/api/models/onnx-community/Qwen3-0.6B-ONNX/tree/58ca03a5e7b354b480b1a82b34bde8dc7b854cc0/onnx?recursive=false&expand=false); no weight download |

These rows are separate files/groups, **not** a measured complete first-start transfer. Tokenizers,
configuration, transitive modules and other runtime files also consume bandwidth/storage. The
UI's approximately 360 MB GPU / 620 MB WASM notices are estimates, not totals measured by this
revision. WASM weights use the explicit revision in `src/chat/model.ts`; the WebLLM default GPU
weights and model library resolve through upstream `main`. The Transformers ESM entry imports
an unversioned `onnxruntime-common` entry as well as a versioned ONNX Web entry. The entry runtime
versions are pinned, but the entire external graph is not immutable. Availability may change.

The request supplied a reference ZIP size of **32,869,746**, expanded size **69,745,062** and
browser-AI runtime size **36,378,941 bytes**, with SHA-256
`2c852405d0f488d75aa34841ba672772729ee3282206d8235432a8f553fc9144`.
Those are **requester-supplied provenance figures**, not a ZIP download/hash repeated in this
revision. No reference ZIP, dependency archive, registry mirror, package cache or `node_modules`
is submitted. No required renderer, model or audio file was removed to reduce the payload.

## Publication constraints and platform status

The actual assignment limit is **8,388,608 bytes (8 MiB)** for the submission. A single sampled
AI WASM file already exceeds it; the language-model weights exceed it many times over. The game
therefore uses the existing explicitly documented **free client-side CDN runtime arrangement**:
all renderer/game/model/audio files are local to the export; optional AI runtime libraries and
weights load directly from public CDNs onto each visitor's device after an explicit start.
No inference server, owner computer, API key, wallet transaction or paid storage is involved.
The [third-party license directory](../licenses/) is retained. Internet access to the CDN/model
origins is required for a first AI load; browser cache/storage and memory limits still apply.

The static publisher must serve the **whole `dist/` tree**, including `assets/`, `models/`,
`audio/`, favicon and OG image, with normal JavaScript/GLB MIME types and valid HTTPS. Vite uses
`base: './'` and this is a single-page app without server-side routing. Local Chromium checks
proved rendering with all external requests blocked; homepage HTTP 200 alone was not treated
as acceptance. This run served the export at a local root URL; gateway-subpath deployment and
production TLS were not independently exercised.

**Canonical new job URL:** not supplied by the platform in this revision.
**Canonical preview URL:** not supplied by the platform in this revision.
**Repository hosting URL:** not supplied by the platform in this revision.

The repository/export is the deliverable; IMD must supply the new job and preview identifiers
after its publication step and verify the entire deployed export and normal TLS there. No
additional platform per-file limit, path allowlist or deployment import result was supplied, so
none is invented here. No publishing command, new paid order, automatic Genesis submission,
DNS/VPS change, owner-site replacement or old review-record replacement was attempted. An eventual
new preview URL is not evidence that an old Genesis VISIT link is repaired.

## Better Interface review

Used the pinned workflow and core principles of all six domains. The accepted visual system was
preserved; this revision changes validation and delivery evidence. The final design tokens,
typography, components and breakpoints remain documented in [DESIGN.md](../DESIGN.md).

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked, with limits | Native controls and labels in `src/ui/Stage.tsx:139`, `src/App.tsx:472`, keyboard alternatives, polite status at `src/App.tsx:536`, `:focus-visible` in `src/styles.css:77`. Keyboard gesture/Enter paths passed. Probe: all 26 first-screen controls meet its 24px/spacing rule; four are below its 44px comfort target. Full Tab/focus walk, screen-reader session, forced-colors and native 200% zoom **not performed**. |
| Layout | Checked, with limits | Four responsive screenshots and no-overflow checks; model and snacks visible at 390; bounded three-card stack at 320. Desktop two-column layout and 768 single column inspected. RTL is not a supported locale and was not tested. Native zoom **not performed**. |
| Writing | Checked | `src/i18n.ts:87` and `:324` provide the existing bilingual restore error. Browser observes English rejection, Traditional Chinese card/game/network labels, explicit Simulated rehearsal and unavailable-source language. No new wording invents a completed job or payout. Full native-language editorial review **not performed**. |
| Typography | Checked, with limits | Five declared rem size tokens, one fallback stack, weights 400/600 and tabular counters. Probe sees three repeated sizes/four including the one-off heading on the initial screen; no tracking/casing/glyph failures. Actual fallback font availability on phones **not verified**. |
| Colors | Checked, with limits | Existing semantic tokens retained. Probe's resolved solid-background text passes; the smallest measured ratio was **6.5:1** on the desktop tagline, `#65523f` against `#f7efe3`. **26 text boxes over canvas/gradients were excluded**; translucent-chip and image/gradient contrast is unmeasured. DESIGN.md's broader old contrast claim was narrowed to match the evidence. |
| UI | Checked, with limits | First-screen actions, selected modes/tabs, sleeping/eating states, rejected-save state, card stack and recovery after restore/reload inspected. Probe reports no border+shadow stacking, `transition: all` or CSS animation left running under reduced motion. `src/scene/PetScene.ts:477` handles reduced 3D amplitude in source; this was not a full measured 3D-motion audit. Slow-motion replay and audio-state browser walk **not performed**. |

All **16** probe checks passed: render, layout, targets, contrast, casing, tracking, eyebrows,
type-sizes, type-faces, glyphs, slogans, repetition, copy-budget, chrome, motion and share. Passing
the initial-screen probe does not extend its coverage to every tab or satisfy the limitations
above. No additional visual-source change was justified by the scoped review. The screenshot
capture now waits for the Chinese event card's entrance animation before saving its image.

Design guidance attribution: Jakub Krehel, Better Interface, commit
`267330e1adfc66a718fb65fa6918c1f06d0a689e` (MIT); documentation method adapted from Paul Bakaus,
Impeccable, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Apache-2.0). The supplied notices
and both license texts are preserved in [licenses/design-guidance.txt](../licenses/design-guidance.txt).

## Completion boundary

**Complete for this revision's two findings:** the crash is reproduced and fixed, regressions
pass, the static export is rebuilt, and the previously missing report/screenshots are delivered.
**Full original-product acceptance remains unverified** for real-model inference, physical-device
coverage, the unperformed checks above and publication on a platform-supplied URL. These limits
are not reported as passes or replaced with simulated evidence.
