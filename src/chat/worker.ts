/// <reference lib="webworker" />
// Runs the language model inside a dedicated worker on the visitor's own device.
import { GPU, WASM, type Backend, type ChatMsg } from './model';

type In =
  | { type: 'load'; backend: Backend }
  | { type: 'generate'; id: number; messages: ChatMsg[] }
  | { type: 'stop' };

/* eslint-disable @typescript-eslint/no-explicit-any */
let engine: any = null; // WebLLM engine
let generator: any = null; // transformers.js pipeline
let streamerCtor: any = null;
let stopper: any = null;
let backend: Backend | null = null;

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

async function load(b: Backend) {
  backend = b;
  if (b === 'webgpu') {
    const gpu = (navigator as any).gpu;
    if (!gpu) throw new Error('no-webgpu');
    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new Error('no-webgpu');
    const webllm = await import(/* @vite-ignore */ GPU.runtime);
    engine = await webllm.CreateMLCEngine(GPU.model, {
      initProgressCallback: (r: { progress: number; text: string }) => post({ type: 'progress', progress: r.progress }),
    });
  } else {
    const tf = await import(/* @vite-ignore */ WASM.runtime);
    tf.env.allowLocalModels = false;
    streamerCtor = tf.TextStreamer;
    stopper = new tf.InterruptableStoppingCriteria();
    const files = new Map<string, { loaded: number; total: number }>();
    generator = await tf.pipeline('text-generation', WASM.model, {
      revision: WASM.revision,
      dtype: WASM.dtype,
      device: 'wasm',
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === 'progress' && p.file) {
          files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
          let l = 0;
          let t = 0;
          for (const f of files.values()) {
            l += f.loaded;
            t += f.total;
          }
          if (t) post({ type: 'progress', progress: l / t });
        }
      },
    });
  }
  post({ type: 'ready', backend: b });
}

async function generate(id: number, messages: ChatMsg[]) {
  if (backend === 'webgpu' && engine) {
    const chunks = await engine.chat.completions.create({ messages, stream: true, temperature: 0.7, max_tokens: 160 });
    for await (const c of chunks) {
      const t = c.choices?.[0]?.delta?.content;
      if (t) post({ type: 'token', id, text: t });
    }
  } else if (generator) {
    stopper.reset();
    const streamer = new streamerCtor(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => post({ type: 'token', id, text }),
    });
    await generator(messages, { max_new_tokens: 160, do_sample: true, temperature: 0.7, streamer, stopping_criteria: stopper });
  } else throw new Error('not-loaded');
  post({ type: 'done', id });
}

self.onmessage = async (ev: MessageEvent<In>) => {
  const m = ev.data;
  try {
    if (m.type === 'load') await load(m.backend);
    else if (m.type === 'generate') await generate(m.id, m.messages);
    else if (m.type === 'stop') {
      if (engine) engine.interruptGenerate();
      if (stopper) stopper.interrupt();
    }
  } catch (e) {
    post({ type: 'error', id: m.type === 'generate' ? m.id : undefined, message: String((e as Error)?.message || e) });
  }
};
