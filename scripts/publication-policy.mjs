// Observed on the canonical public HTML response, 2026-11-03. A regression fixture,
// not an instruction to weaken or change the host's policy. blob: is allowed for images,
// but is intentionally absent from connect-src (used by ImageBitmapLoader's fetch).
export const PUBLICATION_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; media-src 'self' data: blob: https:; connect-src 'self' https: wss:; frame-src https:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
