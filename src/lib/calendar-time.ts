import { validDate } from "./calendar-config";
export function validTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}
export function zonedParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}
// Enumerate actual offsets near the requested wall clock, then verify by round trip.
// Zero matches is a DST gap; two matches is a repeated clock time. Neither is guessed.
export function zonedInstant(date: string, time: string, zone: string) {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !validTimeZone(zone))
    throw new Error("Choose a valid date, time, and time zone.");
  const wall = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = wall + hours * 3600000;
    const parts = zonedParts(new Date(sample), zone);
    offsets.add(Date.parse(`${parts.date}T${parts.time}Z`) - sample);
  }
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((value) => {
      const parts = zonedParts(new Date(value), zone);
      return parts.date === date && parts.time === `${time}:00`;
    });
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "This time occurs twice during a daylight-saving change. Choose an unambiguous time."
        : "This time does not exist during a daylight-saving change. Choose another time.",
    );
  return new Date(candidates[0]!).toISOString();
}
