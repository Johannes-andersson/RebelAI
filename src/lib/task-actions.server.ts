import { emptyTask, filterTasks, type TaskInput } from "./task-config";
import { resolveEventDate } from "./calendar-action.server";
import { calendarClock } from "./calendar-parser";
import { zonedParts } from "./calendar-time";
import type { TaskRepository } from "./tasks.server";
export function taskRequest(prompt: string, db: TaskRepository, zone: string, now = new Date()) {
  const text = prompt
    .trim()
    .replace(/^please\s+/i, "")
    .replace(/[.!?]$/, "");
  if (/^(?:explain|how|write|translate|imagine|if|don't|do not)\b/i.test(text)) return null;
  if (/^(?:show|list|what)[\s\S]*\b(?:tasks|overdue|to-do)\b/i.test(text)) {
    const tasks = filterTasks(
      db.list(),
      {
        status: /completed/i.test(text) && !/uncompleted/i.test(text) ? "completed" : "active",
        due: /overdue/i.test(text) ? "overdue" : "",
      },
      now,
    );
    const project = db.projects().filter((p) => text.toLowerCase().includes(p.name.toLowerCase()));
    if (/\bproject\b/i.test(text) && project.length === 0)
      return {
        text: "No matching project found. Please name an existing project or create it in Tasks.",
      };
    if (project.length > 1)
      return { text: "Which project should I show? Please name one project." };
    const selected =
      project.length === 1 ? tasks.filter((t) => t.projectId === project[0]!.id) : tasks;
    return {
      text: selected.length
        ? selected
            .slice(0, 50)
            .map(
              (t) =>
                `• ${t.title} — ${t.priority}${t.dueDate ? `, due ${t.dueDate} ${t.dueTime}` : ""}`,
            )
            .join("\n")
        : "No matching tasks.",
    };
  }
  const create =
    /^(?:add|create)\s+(?:a\s+)?(?:(low|medium|high)[ -]priority\s+)?(?:task|to-do)(?:\s+to)?\s+(.+)$/i.exec(
      text,
    );
  if (create) {
    let title = create[2]!,
      draft = emptyTask(zone);
    const due = /\s+by\s+(.+)$/i.exec(title);
    if (due) {
      title = title.slice(0, due.index);
      const parts = due[1]!.split(/\s+at\s+/i);
      draft.dueDate = resolveEventDate(parts[0]!, zonedParts(now, zone).date);
      draft.dueTime = parts[1] ? calendarClock(parts[1]) : "";
      if (!draft.dueDate || (parts[1] && !draft.dueTime))
        return {
          text: "Please specify an unambiguous due date and time (with AM/PM). Nothing was saved.",
        };
    }
    draft = {
      ...draft,
      title,
      priority: (create[1]?.toLowerCase() ?? "medium") as TaskInput["priority"],
    };
    return { draft, operation: "create" as const, targetId: null, version: 0 };
  }
  const change =
    /^(mark|complete|delete|remove|move|edit)\s+(?:(?:the|my)\s+)?(.+?)\s+task(?:\s+(.*))?$/i.exec(
      text,
    );
  if (!change) return null;
  const matches = db.list().filter((t) => t.title.toLowerCase().includes(change[2]!.toLowerCase()));
  if (matches.length !== 1)
    return {
      text: matches.length
        ? "Several tasks match. Please use the exact task title, or choose it in Tasks. Nothing was changed."
        : "No task matches that title. Please check Tasks. Nothing was changed.",
    };
  const t = matches[0]!;
  const { id: _id, version: _version, createdAt: _created, updatedAt: _updated, ...draft } = t;
  if (/mark|complete/i.test(change[1]!))
    draft.completed = !/incomplete|unfinished/i.test(change[3] ?? "");
  if (change[1]!.toLowerCase() === "move") {
    const name = (change[3] ?? "")
      .replace(/^(?:in)?to\s+(?:the\s+)?/i, "")
      .replace(/\s+project\.?$/i, "");
    const projects = db.projects().filter((p) => p.name.toLowerCase() === name.toLowerCase());
    if (projects.length !== 1)
      return {
        text: "Which existing project should this task use? Create a project in Tasks first if needed. Nothing was changed.",
      };
    draft.projectId = projects[0]!.id;
  }
  return {
    draft,
    operation: /delete|remove/i.test(change[1]!) ? ("delete" as const) : ("update" as const),
    targetId: t.id,
    version: t.version,
  };
}
