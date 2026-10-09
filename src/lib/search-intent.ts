import type { StoredMessage } from "./types";
export interface SearchIntent {
  needed: boolean;
  query: string | null;
}
const freshness =
  /\b(latest|current|currently|today|tonight|tomorrow|yesterday|recent|recently|breaking|up.to.date|this (?:week|month|year)|right now)\b/i;
const volatile =
  /\b(news|weather|forecast|stock price|exchange rate|election results|live score|prices?|availability)\b/i;
const lookup =
  /\b(search (?:the )?(?:web|internet|online)|look up|look .* up online|find (?:recent |current )?(?:information|sources|links)|verify online)\b/i;
const local =
  /^(?:please\s+)?(?:write (?:a |an |me |some )?(?:poem|story|function|code|essay|email)|translate\b|summari[sz]e (?:our|this|my|the attached|these|above)\b|debug\b|help me (?:debug|write|code)|remember (?:that|this)|save this to memory|keep this in memory)/i;
const contextual =
  /^(?:and\b|what about\b|how about\b|what changed(?: since then| recently|\?|$)|is (?:it|that|this)\b|has (?:it|that|this)\b|how much(?: is it| does it|\?|$)|where (?:can|could) (?:I|we) (?:buy|get|find) (?:it|that|them)\b|find (?:sources|links)(?:\?|$))/i;
function compact(text: string) {
  // Do not send pasted code, credentials, URLs with private queries, or long text.
  return text
    .split(/[\n\r]/, 1)[0]!
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, " ")
    .replace(/\b(?:sk-|ghp_|github_pat_)[\w-]+/g, " ")
    .replace(/\b(?:api[_ -]?key|password|token|secret)\s*[:=]\s*\S+/gi, " ")
    .replace(
      /^(?:please\s+)?(?:search (?:the )?(?:web|internet|online)(?: for)?|look up|find (?:recent |current )?information (?:about|on))\s*:?\s*/i,
      "",
    )
    .replace(/\b(?:what['’]s|what|who|is|are|the|a|an|of|in|about|please|tell me|can you)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 40)
    .join(" ")
    .slice(0, 240);
}
export function searchIntent(prompt: string, history: StoredMessage[] = []): SearchIntent {
  const text = prompt.trim();
  if (
    /\b(?:do not|don't|never) (?:search|browse|use the (?:web|internet))\b/i.test(text) ||
    (local.test(text) && !lookup.test(text))
  )
    return { needed: false, query: null };
  if (/^explain\b/i.test(text) && !freshness.test(text) && !lookup.test(text))
    return { needed: false, query: null };
  const direct =
    lookup.test(text) ||
    freshness.test(text) ||
    volatile.test(text) ||
    /\bwho (?:is|runs|leads)\b.*\b(?:CEO|president|prime minister|company)\b/i.test(text);
  const followup =
    text.length < 180 &&
    (contextual.test(text) || /\b(?:its|their) (?:latest|current|price|version)\b/i.test(text));
  const previous = history.filter((m) => m.role === "user" && m.status === "complete").slice(-1)[0];
  const previousQuery = previous ? compact(previous.content) : "";
  const previousNeeds =
    previous &&
    (freshness.test(previous.content) ||
      volatile.test(previous.content) ||
      lookup.test(previous.content) ||
      /\b(?:CEO|president|prime minister)\b/i.test(previous.content));
  const needed = direct || !!(followup && previousNeeds);
  if (!needed) return { needed: false, query: null };
  const query = compact(text);
  // Only a single bounded topic from the previous user turn for genuine follow-ups.
  const combined =
    followup && previousQuery && !local.test(previous!.content)
      ? `${previousQuery.slice(0, 140)} ${query}`
      : query;
  return { needed: true, query: combined.length >= 3 ? combined.slice(0, 360) : null };
}
