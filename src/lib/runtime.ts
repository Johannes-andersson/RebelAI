// Runtime adapter boundary. Today: mocked. Later: Ollama, llama.cpp,
// OpenAI-compatible providers via the local FastAPI backend.

export interface ChatRuntime {
  streamReply(prompt: string, onToken: (chunk: string) => void, signal?: AbortSignal): Promise<void>;
}

const canned: Array<[RegExp, string]> = [
  [/rebel/i, "Rebel AI is a local-first AI workspace designed to let you run powerful AI models directly on your computer without complicated setup. Your conversations, files, and models stay on your machine — no accounts, no cloud, no terminal."],
  [/code|python|function/i, "Happy to help. Tell me what you're trying to build, which language you prefer, and any constraints. I'll sketch a small working version first, then we can refine it together."],
  [/explain|what is/i, "Sure. I'll start with a plain-language overview, then go one level deeper with an example. Stop me any time you want more detail or a simpler version."],
];

export const mockRuntime: ChatRuntime = {
  async streamReply(prompt, onToken, signal) {
    const reply =
      canned.find(([re]) => re.test(prompt))?.[1] ??
      "Got it. I'm running entirely on your computer, so take your time — share as much context as you like and I'll work through it with you step by step.";
    const words = reply.split(/(\s+)/);
    await new Promise((r) => setTimeout(r, 450));
    for (const w of words) {
      if (signal?.aborted) return;
      onToken(w);
      await new Promise((r) => setTimeout(r, 18 + Math.random() * 40));
    }
  },
};
