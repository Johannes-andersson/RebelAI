import { explicitMemoryContent } from "./memory-config";
import type { MemoryRepository } from "./memories.server";
export function memoryRequest(prompt: string, db: MemoryRepository) {
  prompt = prompt.replace(
    /^(update|edit) my (.+?) preference[.!]?$/i,
    "$1 my saved preference about $2",
  );
  const content = explicitMemoryContent(prompt);
  if (content !== null) {
    if (!db.settings().enabled)
      return { text: "Memory is turned off. Enable it in Settings to save memories." };
    return {
      operation: "create" as const,
      targetId: null,
      expectedUpdatedAt: null,
      content,
      category: "",
    };
  }
  const read =
    /^(?:what do you remember|show (?:my |saved )?memories|search (?:my |saved )?memories)(?: about (.+))?\??$/i.exec(
      prompt.trim(),
    );
  if (read) {
    const query = read[1]?.replace(/\?$/, "").toLowerCase() ?? "";
    const list = db
      .list()
      .filter((m) => !query || m.content.toLowerCase().includes(query.replace(/^my /, "")));
    return {
      text: list.length
        ? list
            .slice(0, 20)
            .map((m) => `• ${m.content}`)
            .join("\n")
        : "No matching saved memories.",
    };
  }
  const change =
    /^(forget|delete|update|edit) (?:my |the )?(?:saved )?(?:memory|preference)(?: about)? (.+)$/i.exec(
      prompt.trim(),
    );
  if (!change) return null;
  const words = change[2]!
    .toLowerCase()
    .replace(/[.?!]$/, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const matches = db.list().filter((m) => words.some((w) => m.content.toLowerCase().includes(w)));
  if (matches.length !== 1)
    return {
      text: matches.length
        ? "Several saved memories match. Please edit the exact entry in Settings → Memory. Nothing changed."
        : "No matching saved memory. Check Settings → Memory; nothing changed.",
    };
  const m = matches[0]!;
  return {
    operation: /forget|delete/i.test(change[1]!) ? ("delete" as const) : ("update" as const),
    targetId: m.id,
    expectedUpdatedAt: m.updatedAt,
    content: m.content,
    category: m.category ?? "",
  };
}
