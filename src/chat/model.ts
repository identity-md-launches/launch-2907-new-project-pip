// Free, browser-only inference. Runtimes are loaded from pinned public CDN versions (jsDelivr) and
// model weights from pinned Hugging Face revisions; nothing runs on a server or the owner's machine.
export const GPU = {
  runtime: 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.87/+esm',
  model: 'Qwen3-0.6B-q4f16_1-MLC',
  downloadMB: 360,
};
export const WASM = {
  runtime: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm',
  model: 'onnx-community/Qwen3-0.6B-ONNX',
  revision: '58ca03a5e7b354b480b1a82b34bde8dc7b854cc0',
  dtype: 'q8',
  downloadMB: 620,
};

export type Backend = 'webgpu' | 'wasm';
export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface PipContext {
  lang: 'en' | 'zh-Hant';
  stage: string;
  bond: number;
  energy: number;
  fullness: number;
  asleep: boolean;
}

export const MAX_INPUT = 280;
const MAX_TURNS = 6;

/** The character context only carries numbers and fixed labels, never free text from the page. */
export function buildMessages(history: ChatMsg[], ctx: PipContext): ChatMsg[] {
  const n = (x: number) => Math.round(Math.max(0, Math.min(100, x)));
  const lang = ctx.lang === 'zh-Hant' ? 'Traditional Chinese (繁體中文)' : 'English';
  const system =
    `You are Pip, a small, kind pet hamster living in a browser game. Stage: ${ctx.stage.replace(/[^a-z ]/gi, '')}. ` +
    `Bond ${n(ctx.bond)}/100, energy ${n(ctx.energy)}/100, fullness ${n(ctx.fullness)}/100${ctx.asleep ? ', just woken from a nap' : ''}. ` +
    `Reply in ${lang}, in one or two short, warm sentences, as a hamster. ` +
    'You cannot see the screen, move money, sign transactions or know prices. Never give financial advice. ' +
    'If asked about Squeekchain or IMD, say you only watch public chain events and that a request is not a finished job. /no_think';
  const turns = history
    .filter((m) => m.role !== 'system' && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_INPUT * 2) }));
  return [{ role: 'system', content: system }, ...turns];
}

/** Removes reasoning blocks (including an unfinished one while streaming). */
export function visibleReply(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .replace(/^\s+/, '');
}
