import { emptyDraft, localDate, validDate, type EventDraft } from "./calendar-config";

// Deliberately narrow, local parsing. Unrecognized details remain for the user to fill in.
export function describeEvent(
  text: string,
  now = new Date(),
): { draft: EventDraft; notices: string[] } {
  const draft = { ...emptyDraft(), source: "ai" as const, description: text.trim() };
  const notices = [
    "Review every detail before saving. Dates and times use this computer's time zone. No reminder notification will be sent.",
  ];
  let remaining = text
    .trim()
    .replace(/^(?:please\s+)?(?:add|create|schedule)\s+(?:an?\s+)?/i, "")
    .replace(/^remind me to\s+/i, "");
  const matches = [
    ...remaining.matchAll(
      /\b(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{4}-\d{2}-\d{2}|the\s+\d{1,2}(?:st|nd|rd|th))\b/gi,
    ),
  ];
  if (matches.length === 1) {
    const match = matches[0]!;
    const token = match[0].toLowerCase();
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    if (token === "tomorrow") date.setDate(date.getDate() + 1);
    else if (days.includes(token)) {
      date.setDate(date.getDate() + ((days.indexOf(token) - date.getDay() + 7) % 7 || 7));
      notices.push("The weekday means its next occurrence. Check the proposed date.");
    } else if (token.startsWith("the ")) {
      const day = Number(token.match(/\d+/)?.[0]);
      date.setDate(1);
      if (day <= now.getDate()) date.setMonth(date.getMonth() + 1);
      const month = date.getMonth();
      date.setDate(day);
      if (date.getMonth() !== month || day < 1)
        notices.push("That day does not exist in the next month. Choose the date.");
      else draft.date = localDate(date);
      notices.push("Review the month: this is a one-time event, not a recurring reminder.");
    } else if (/^\d/.test(token)) {
      if (validDate(token)) draft.date = token;
    }
    if (!token.startsWith("the ") && !/^\d/.test(token)) draft.date = localDate(date);
    remaining = remaining.replace(match[0], "");
  }
  const range =
    /\bfrom\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:to|until|-)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i.exec(
      remaining,
    );
  const single = /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i.exec(remaining);

  if (range) {
    draft.time = calendarClock(range[1]!);
    draft.endTime = calendarClock(range[2]!);
    if (draft.endTime) draft.endDate = draft.date;
    remaining = remaining.replace(range[0], "");
  } else if (single) {
    draft.time = calendarClock(single[1]!);
    remaining = remaining.replace(single[0], "");
  }
  if (/\ball day\b/i.test(remaining)) {
    draft.allDay = true;
    remaining = remaining.replace(/\ball day\b/i, "");
  }
  draft.title = remaining
    .replace(/\b(on|at)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  if (!draft.date) notices.push("The date is missing or ambiguous. Choose it below.");
  if (!draft.allDay && !draft.time)
    notices.push("The time is missing or ambiguous. Choose a time or mark this as all day.");
  if (range && (!draft.time || !draft.endTime))
    notices.push("Please specify AM/PM or use 24-hour times for the time range.");
  if (/\b(next|this|every|weekly|monthly|daily|tonight|noon|midnight)\b/i.test(text)) {
    draft.date = "";
    draft.time = "";
    draft.endDate = "";
    draft.endTime = "";
    notices.push(
      "This wording needs clarification. Enter the date and time explicitly; recurrence is not supported.",
    );
  }
  if (
    /\b(?:or|utc|gmt|est|edt|cst|cdt|mst|mdt|pst|pdt|cet|cest)\b|[+-]\d{2}:?\d{2}|\b[A-Za-z_]+\/[A-Za-z_]+\b/i.test(
      text,
    )
  ) {
    draft.date = "";
    draft.time = "";
    draft.endDate = "";
    draft.endTime = "";
    notices.push(
      "Alternative dates/times and explicit time zones need manual review. Enter the event in this computer's time zone.",
    );
  }
  return { draft, notices };
}

export function calendarClock(value: string) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(value.trim());
  if (!m) return "";
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? "0");
  const period = m[3]?.toLowerCase();
  if (minute > 59 || hour > 23 || (period && (hour < 1 || hour > 12))) return "";
  if (!period && !m[2]) return ""; // Bare "3" is ambiguous; never choose AM/PM for the user.
  if (period) hour = (hour % 12) + (period === "pm" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
