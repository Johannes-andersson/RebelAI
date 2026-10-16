import type { ConversationRepository } from "./conversations.server";
import { taskRequest } from "./task-actions.server";
import { memoryRequest } from "./memory-actions.server";
import { reminderRequest } from "./reminders.server";
import type { DocumentSource } from "./document-config";
import type { ToolActivity } from "./tool-plan";
export function personalRequest(prompt: string) {
  return /\b(?:tasks?|to-do|remind me|notify me|remember|memories|memory|preferences?)\b/i.test(
    prompt,
  );
}
// Only split explicit user-authored commands. Retrieved/model text never enters routing.
export function prepareAssistantActions(
  db: ConversationRepository,
  prompt: string,
  zone: string,
  messageId: string,
  userMessageId: string,
  evidence: DocumentSource[] | null,
  now = new Date(),
) {
  const parts = prompt
    .split(
      /,?\s+(?:and\s+)?(?=(?:create a task|add a task|prepare a calendar|show me|remember that|remind me|notify me)\b)/i,
    )
    .map((s) => s.trim().replace(/,$/, ""));
  const messages: string[] = [],
    activity: ToolActivity[] = [];
  let taskDone = false,
    memoryDone = false,
    reminderDone = false;
  for (const part of parts.slice(0, 4)) {
    const reminder = reminderRequest(part, zone, now, db);
    if (reminder && !reminderDone) {
      const a = db.reminders.stage(messageId, userMessageId, reminder);
      messages.push(
        a.status === "pending"
          ? "Review the reminder below. Nothing is scheduled until you confirm."
          : "This reminder request was already handled.",
      );
      reminderDone = true;
      activity.push({
        tool: "reminders",
        status: "complete",
        notice: "Prepared reminder — confirmation required",
      });
      continue;
    }
    const referencedProject = /\bmy (.+?) project\b/i.exec(prompt)?.[1];
    const taskText =
      referencedProject && /\bits unfinished tasks\b/i.test(part)
        ? part.replace(/its unfinished tasks/i, `unfinished tasks in ${referencedProject} project`)
        : part;
    const task = taskRequest(taskText, db.tasks, zone, now);
    if (task && !taskDone) {
      if ("draft" in task && task.draft) {
        if (evidence?.length && !task.draft.dueDate) {
          const dates = [
            ...new Set(evidence.flatMap((s) => s.text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [])),
          ];
          if (dates.length === 1) {
            task.draft.dueDate = dates[0]!;
            messages.push(
              `Proposed task deadline comes from a limited document excerpt [D${evidence.findIndex((s) => s.text.includes(dates[0]!)) + 1}]. Verify the date before confirming.`,
            );
          } else
            messages.push(
              "The excerpts do not establish one unambiguous deadline. Choose the task due date before confirming.",
            );
        }
        const a = db.tasks.stage(messageId, userMessageId, task);
        messages.push(
          a.status === "pending"
            ? "Review the task below, then confirm. Nothing has changed yet."
            : "This task request was already handled. No duplicate change was made.",
        );
      } else messages.push(task.text ?? "Please clarify the task.");
      taskDone = true;
      activity.push({
        tool: "tasks",
        status: "complete",
        notice: "Read local tasks / prepared confirmation",
      });
      continue;
    }
    if (
      /^(?:please\s+)?(?:remember|save this to memory|keep this in memory|what do you remember|show.*memories|search.*memories|forget|delete.*memory|update.*(?:memory|preference)|edit.*(?:memory|preference))/i.test(
        part,
      )
    ) {
      const memory = memoryRequest(part, db.memories);
      if (memory && !memoryDone) {
        if ("content" in memory && memory.content) {
          const a = db.memories.stage(messageId, userMessageId, memory);
          messages.push(
            a.status === "pending"
              ? "Review this memory and confirm before saving. Nothing has changed yet."
              : "This memory request was already handled.",
          );
        } else messages.push(memory.text ?? "Please clarify the memory.");
        memoryDone = true;
        activity.push({
          tool: "memory",
          status: "complete",
          notice: "Read local memory / prepared confirmation",
        });
      }
    }
  }
  if (
    !activity.length &&
    /^(?:please\s+)?(?:add|create|edit|update|delete|remove|mark|complete|move|remember|forget|remind|notify)\b/i.test(
      prompt,
    ) &&
    personalRequest(prompt)
  ) {
    messages.push(
      "I could not identify a safe, complete action. Please name the task, reminder, or memory and the change you want, or use its page. Nothing was changed.",
    );
    activity.push({
      tool: /memory|remember|forget|preference/i.test(prompt)
        ? "memory"
        : /remind|notify/i.test(prompt)
          ? "reminders"
          : "tasks",
      status: "unavailable",
      notice: "Clarification required; no change made",
    });
  }
  return { text: messages.join("\n\n"), activity, reminder: reminderDone };
}
