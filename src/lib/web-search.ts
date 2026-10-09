import { z } from "zod";
export function safeWebUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
export const webSourceSchema = z.object({
  id: z
    .string()
    .regex(/^S[1-5]$/)
    .optional(),
  title: z.string().max(200),
  url: z.string().max(2000).refine(safeWebUrl),
  snippet: z.string().max(1200),
});
export type WebSource = z.infer<typeof webSourceSchema>;
export const webSearchSchema = z.object({
  status: z.enum(["searching", "complete", "unavailable", "disabled"]),
  notice: z.string().max(500),
  sources: webSourceSchema.array().max(5),
  searchedAt: z.string().optional(),
});
export type WebSearch = z.infer<typeof webSearchSchema>;
export const internetSchema = z.object({ enabled: z.boolean() });

// IDs belong to the saved result set, never to model output. Legacy rows use
// their original persisted order; no external lookup is needed during reload.
export function identifiedSources(sources: WebSource[]): WebSource[] {
  const ids = sources.map((source) => source.id);
  if (ids.every(Boolean) && new Set(ids).size === ids.length) return sources;
  return sources.map((source, index) => ({ ...source, id: `S${index + 1}` }));
}

export function webAnswerText(content: string, search: WebSearch | undefined): string {
  if (!search) return content;
  const ids = new Set(identifiedSources(search.sources).map((source) => source.id));
  // Keep code literal: array indices and example URLs are not citations. The
  // Markdown renderer never activates links inside code, or any web-answer link.
  return content
    .split(/(`{3,}[^\n]*\n[\s\S]*?(?:`{3,}|$)|~{3,}[^\n]*\n[\s\S]*?(?:~{3,}|$)|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part
            .replace(/\[([^\]]*)\]\([^)]*(?:\)|$)/g, "$1 (link omitted; see sources)")
            .replace(/(?:https?:\/\/|www\.)[^\s)\]]*/gi, "(link omitted; see sources)")
            .replace(/\[([^\]\n]*)\]/g, (match, ref: string) => {
              if (!/^(?:S[^\s]*|\d+)$/.test(ref)) return match;
              const id = /^S[1-5]$/.test(ref) ? ref : /^\d+$/.test(ref) ? `S${ref}` : undefined;
              return id && ids.has(id) ? `[${id}]` : "(unsupported reference)";
            })
            .replace(/\[(?:S[^\]\n]*|\d*)$/, "")
            .replace(/https?:?\/?\/?$/i, ""),
    )
    .join("");
}
