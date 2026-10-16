import type { Recurrence } from "@/lib/recurrence";
export function RecurrenceFields({
  value,
  onChange,
}: {
  value: Recurrence | null | undefined;
  onChange: (v: Recurrence | null) => void;
}) {
  return (
    <fieldset className="space-y-3">
      <label>
        Repeats
        <select
          className="ml-2 bg-background p-2"
          value={value?.frequency ?? ""}
          onChange={(e) =>
            onChange(
              e.target.value
                ? {
                    frequency: e.target.value as Recurrence["frequency"],
                    weekdays: [],
                    until: null,
                    count: null,
                  }
                : null,
            )
          }
        >
          <option value="">Does not repeat</option>
          {["daily", "weekly", "monthly"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      {value && (
        <>
          <p className="text-xs">
            Short months skip missing dates. DST gaps/repeated times are skipped with a notice.
          </p>
          {value.frequency === "weekly" && (
            <div>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
                <label key={day} className="mr-2">
                  <input
                    type="checkbox"
                    checked={value.weekdays.includes(i)}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        weekdays: e.target.checked
                          ? [...value.weekdays, i]
                          : value.weekdays.filter((d) => d !== i),
                      })
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
          )}
          <label>
            Repeat until
            <input
              className="bg-background p-2"
              type="date"
              value={value.until ?? ""}
              onChange={(e) => onChange({ ...value, until: e.target.value || null })}
            />
          </label>
          <label className="ml-3">
            Maximum occurrences
            <input
              className="bg-background p-2 w-24"
              type="number"
              min={1}
              max={1000}
              value={value.count ?? ""}
              onChange={(e) =>
                onChange({ ...value, count: e.target.value ? Number(e.target.value) : null })
              }
            />
          </label>
        </>
      )}
    </fieldset>
  );
}
