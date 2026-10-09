import { webContext } from "./web-search.server";
import type { WebSearch } from "./web-search";
import { documentContext } from "./retrieval.server";
import { memoryContext } from "./memory-service.server";
import type { DocumentSource } from "./document-config";
import type { SavedMemory } from "./memory-config";
import type { Conversation } from "./types";
export function buildChatContext(
  conversation: Conversation,
  documents: DocumentSource[] | null,
  memories: SavedMemory[],
  web?: WebSearch,
) {
  const messages: { role: string; content: string }[] = [];
  if (memories.length) messages.push({ role: "system", content: memoryContext(memories) });
  if (documents !== null) messages.push({ role: "system", content: documentContext(documents) });
  if (web) messages.push(...webContext(web));
  messages.push(
    ...conversation.messages
      .filter((m) => m.status === "complete")
      .map(({ role, content }) => ({ role, content })),
  );
  return messages;
}
