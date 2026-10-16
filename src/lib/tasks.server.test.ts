// @vitest-environment node
import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationRepository } from "./conversations.server";
import { emptyTask, filterTasks } from "./task-config";
import { taskRequest } from "./task-actions.server";
import { handleTasks } from "./tasks.server";
it("preserves tasks/projects and pending confirmation across restart; confirms once and rejects stale edits", () => {
  const dir = mkdtempSync(join(tmpdir(), "rebel-task-")),
    path = join(dir, "test.sqlite");
  let db = new ConversationRepository(path);
  try {
    const project = db.tasks.project("Rebel AI"),
      input = {
        ...emptyTask("UTC"),
        title: "Website",
        projectId: project.id,
        dueDate: "2026-10-16",
      };
    const conversation = randomUUID(),
      message = randomUUID();
    db.create(conversation, null);
    db.beginTurn(conversation, message, "Add website task", "qwen2.5:7b");
    const action = db.tasks.stage(`${message}:assistant`, message, {
      draft: input,
      operation: "create",
      targetId: null,
      version: 0,
    });
    db.saveReply(action.id, "Review", "complete");
    expect(db.tasks.list()).toHaveLength(0);
    db.close();
    db = new ConversationRepository(path);
    expect(db.get(conversation).messages[1]?.taskAction?.status).toBe("pending");
    const first = db.tasks.decide(action.id, "confirm", input);
    expect(db.tasks.decide(action.id, "confirm", input).resultId).toBe(first.resultId);
    expect(db.tasks.list()).toHaveLength(1);
    const task = db.tasks.list()[0]!;
    db.tasks.save({ ...input, completed: true }, task.id, task.version);
    expect(() => db.tasks.save(input, task.id, task.version)).toThrow("changed");
    db.close();
    db = new ConversationRepository(path);
    expect(db.tasks.list()[0]?.completed).toBe(true);
    db.tasks.removeProject(project.id);
    expect(db.tasks.list()[0]?.projectId).toBe(null);
    db.tasks.remove(task.id, 2);
    expect(db.tasks.list()).toHaveLength(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("filters overdue, completed, project and priority without dropping completed tasks", () => {
  const db = new ConversationRepository(":memory:");
  try {
    const p = db.tasks.project("Work");
    db.tasks.save({
      ...emptyTask("UTC"),
      title: "Late",
      dueDate: "2026-01-01",
      priority: "high",
      projectId: p.id,
    });
    db.tasks.save({ ...emptyTask("UTC"), title: "Done", completed: true });
    expect(
      filterTasks(
        db.tasks.list(),
        { due: "overdue", project: p.id, priority: "high" },
        new Date("2026-10-01T12:00Z"),
      ).map((t) => t.title),
    ).toEqual(["Late"]);
    expect(filterTasks(db.tasks.list(), { status: "completed" })).toHaveLength(1);
  } finally {
    db.close();
  }
});
it("parses browser-zone relative dates, previews updates and clarifies ambiguous tasks/projects", () => {
  const db = new ConversationRepository(":memory:");
  try {
    const parsed = taskRequest(
      "Add a task to finish my website by Friday",
      db.tasks,
      "America/Los_Angeles",
      new Date("2026-10-15T02:00Z"),
    );
    expect(parsed).toMatchObject({
      operation: "create",
      draft: { title: "finish my website", dueDate: "2026-10-16" },
    });
    db.tasks.save({ ...emptyTask("UTC"), title: "website one" });
    db.tasks.save({ ...emptyTask("UTC"), title: "website two" });
    expect(taskRequest("Mark the website task as completed", db.tasks, "UTC")).toMatchObject({
      text: expect.stringContaining("Several"),
    });
    expect(
      taskRequest("Move my documentation task into the Rebel AI project", db.tasks, "UTC"),
    ).toMatchObject({ text: expect.stringContaining("No task") });
    expect(taskRequest("Explain how to create a task", db.tasks, "UTC")).toBeNull();
  } finally {
    db.close();
  }
});
it("requires confirmation and blocks cross-origin writes and impossible times", async () => {
  const db = new ConversationRepository(":memory:");
  try {
    const req = (body: unknown, origin = "http://localhost") =>
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin },
        body: JSON.stringify(body),
      });
    const body = {
      kind: "save",
      id: randomUUID(),
      task: {
        ...emptyTask("America/New_York"),
        title: "DST",
        dueDate: "2026-03-08",
        dueTime: "02:30",
      },
      confirmed: true,
    };
    expect((await handleTasks(req(body), db)).status).toBe(400);
    expect((await handleTasks(req(body, "https://evil.example"), db)).status).toBe(403);
    expect((await handleTasks(req({ ...body, confirmed: false }), db)).status).toBe(400);
    expect(db.tasks.list()).toHaveLength(0);
  } finally {
    db.close();
  }
});
it("cancellation persists and regeneration cannot resurrect a cancelled action", () => {
  const db = new ConversationRepository(":memory:");
  try {
    const c = randomUUID(),
      u = randomUUID();
    db.create(c, null);
    db.beginTurn(c, u, "task", "qwen2.5:7b");
    const input = {
      draft: { ...emptyTask("UTC"), title: "Never" },
      operation: "create" as const,
      targetId: null,
      version: 0,
    };
    db.tasks.stage(`${u}:assistant`, u, input);
    db.tasks.decide(`${u}:assistant`, "cancel");
    expect(db.tasks.decide(`${u}:assistant`, "confirm", input.draft).status).toBe("cancelled");
    expect(db.tasks.list()).toHaveLength(0);
  } finally {
    db.close();
  }
});
