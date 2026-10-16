import { z } from "zod";
import { searchIntent } from "./search-intent";
import { explicitCalendarRequest } from "./calendar-action";
import type { StoredMessage } from "./types";
export const toolActivitySchema = z.object({
  tool: z.enum(["documents", "images", "web", "calendar", "tasks", "reminders", "memory"]),
  status: z.enum(["complete", "unavailable"]),
  count: z.number().int().nonnegative().max(100).optional(),
  notice: z.string().max(500),
});
export type ToolActivity = z.infer<typeof toolActivitySchema>;
export const toolLimits = {
  milliseconds: 300_000,
  images: 4,
  files: 20,
  webRequests: 1,
  calendarDrafts: 1,
};
// Fixed, application-owned graph. Retrieved text and model output cannot add steps.
export function planTools(
  prompt: string,
  hasFiles: boolean,
  imageCount: number,
  history: StoredMessage[] = [],
) {
  const calendar = explicitCalendarRequest(prompt);
  const fileRequest = /\b(files?|documents?|pdfs?|contracts?|uploaded|attachments?)\b/i.test(
    prompt,
  );
  const fileCalendar = calendar && fileRequest;
  const publicLookup =
    /\b(web|internet|online|public information|public sources|latest public)\b/i.test(prompt);
  const personalPattern =
    /\b(?:tasks?|to-do|remind me|notify me|remember|memories|memory|preferences?)\b/i;
  const privateAssistant = personalPattern.test(prompt);
  const previous = history.filter((m) => m.role === "user" && m.status === "complete").at(-1);
  const privateHistory =
    previous &&
    (personalPattern.test(previous.content) || explicitCalendarRequest(previous.content));
  const web = privateAssistant
    ? { needed: false, query: null }
    : (calendar || (hasFiles && fileRequest) || imageCount) && !publicLookup
      ? { needed: false, query: null }
      : searchIntent(prompt, hasFiles || imageCount || privateHistory ? [] : history);
  return {
    documents: hasFiles || fileCalendar,
    images: imageCount > 0,
    calendar,
    fileCalendar,
    web,
  };
}
