import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  taskInputSchema,
  taskActionSchema,
  type Task,
  type TaskInput,
  type TaskAction,
  type Project,
} from "./task-config";
import {
  ConversationError,
  getConversations,
  type ConversationRepository,
} from "./conversations.server";
import { checkLocalConversationRequest, conversationFailure } from "./conversation-api.server";
export class TaskRepository {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS task_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, projectId TEXT REFERENCES task_projects(id) ON DELETE SET NULL, data TEXT NOT NULL, dueDate TEXT NOT NULL, completed INTEGER NOT NULL, priority TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS task_due ON tasks(completed,dueDate); CREATE INDEX IF NOT EXISTS task_project ON tasks(projectId,priority);
      CREATE TABLE IF NOT EXISTS task_actions (messageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, userMessageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_receipts (userMessageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, data TEXT NOT NULL);`);
  }
  list(): Task[] {
    return this.db
      .prepare("SELECT data,projectId FROM tasks ORDER BY rowid DESC")
      .all()
      .map((r) => ({ ...JSON.parse(String(r["data"])), projectId: r["projectId"] }));
  }
  projects(): Project[] {
    return this.db
      .prepare("SELECT * FROM task_projects ORDER BY name")
      .all() as unknown as Project[];
  }
  project(name: string, id: string = randomUUID()) {
    const value = z.string().trim().min(1).max(100).parse(name);
    const existing = this.projects().find((p) => p.name.toLowerCase() === value.toLowerCase());
    if (existing && existing.id !== id)
      throw new ConversationError("A project with that name already exists.", 409);
    this.db
      .prepare(
        "INSERT INTO task_projects VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
      )
      .run(id, value);
    return { id, name: value };
  }
  removeProject(id: string) {
    this.db.prepare("DELETE FROM task_projects WHERE id=?").run(id);
  }
  save(input: TaskInput, id: string = randomUUID(), expected?: number): Task {
    const value = taskInputSchema.parse(input),
      old = this.list().find((t) => t.id === id);
    if (expected !== undefined && (!old || old.version !== expected))
      throw new ConversationError("This task changed. Refresh and review it again.", 409);
    if (value.projectId && !this.projects().some((p) => p.id === value.projectId))
      throw new ConversationError("Choose an existing project.", 400);
    const now = new Date().toISOString();
    const task = {
      ...value,
      id,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      version: (old?.version ?? 0) + 1,
    };
    this.db
      .prepare(
        "INSERT INTO tasks VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET projectId=excluded.projectId,data=excluded.data,dueDate=excluded.dueDate,completed=excluded.completed,priority=excluded.priority",
      )
      .run(
        id,
        value.projectId,
        JSON.stringify(task),
        value.dueDate,
        Number(value.completed),
        value.priority,
      );
    return task;
  }
  remove(id: string, expected: number) {
    const old = this.list().find((t) => t.id === id);
    if (!old || old.version !== expected)
      throw new ConversationError("This task changed. Refresh and review it again.", 409);
    this.db.prepare("DELETE FROM tasks WHERE id=?").run(id);
  }
  action(id: string): TaskAction | undefined {
    const row = this.db.prepare("SELECT data FROM task_actions WHERE messageId=?").get(id);
    return row ? taskActionSchema.parse(JSON.parse(String(row["data"]))) : undefined;
  }
  stage(
    id: string,
    userMessageId: string,
    input: Pick<TaskAction, "draft" | "operation" | "targetId" | "version">,
  ) {
    const receipt = this.db
      .prepare("SELECT data FROM task_receipts WHERE userMessageId=?")
      .get(userMessageId);
    const action: TaskAction = receipt
      ? { ...JSON.parse(String(receipt["data"])), id }
      : {
          ...input,
          id,
          userMessageId,
          status: "pending",
          createdAt: new Date().toISOString(),
          resultId: null,
        };
    this.db
      .prepare("INSERT INTO task_actions VALUES (?,?,?)")
      .run(id, userMessageId, JSON.stringify(action));
    return action;
  }
  decide(id: string, decision: "confirm" | "cancel", input?: TaskInput) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const a = this.action(id);
      if (!a) throw new ConversationError("This task preview no longer exists.", 409);
      const receipt = this.db
        .prepare("SELECT data FROM task_receipts WHERE userMessageId=?")
        .get(a.userMessageId);
      if (receipt) {
        this.db.exec("COMMIT");
        return taskActionSchema.parse(JSON.parse(String(receipt["data"])));
      }
      if (a.status !== "pending") {
        this.db.exec("COMMIT");
        return a;
      }
      if (decision === "cancel") a.status = "cancelled";
      else {
        if (Date.now() - Date.parse(a.createdAt) > 86400000)
          throw new ConversationError("This preview expired. Send a new request.", 409);
        if (a.operation === "delete") this.remove(a.targetId!, a.version);
        else {
          if (!input) throw new ConversationError("Review the task details first.", 400);
          a.draft = taskInputSchema.parse(input);
          a.resultId = this.save(
            a.draft,
            a.targetId ?? randomUUID(),
            a.operation === "update" ? a.version : undefined,
          ).id;
        }
        a.status = "saved";
      }
      this.db
        .prepare("INSERT INTO task_receipts VALUES (?,?)")
        .run(a.userMessageId, JSON.stringify(a));
      this.db
        .prepare("UPDATE task_actions SET data=? WHERE userMessageId=?")
        .run(JSON.stringify(a), a.userMessageId);
      this.db.exec("COMMIT");
      return a;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
const mutation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("save"),
    id: z.string().uuid(),
    task: taskInputSchema,
    version: z.number().int().optional(),
    confirmed: z.literal(true),
  }),
  z.object({
    kind: z.literal("delete"),
    id: z.string().uuid(),
    version: z.number().int(),
    confirmed: z.literal(true),
  }),
  z.object({
    kind: z.literal("project"),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    confirmed: z.literal(true),
  }),
  z.object({ kind: z.literal("deleteProject"), id: z.string().uuid(), confirmed: z.literal(true) }),
  z.object({
    kind: z.literal("decide"),
    id: z.string().max(100),
    decision: z.enum(["confirm", "cancel"]),
    task: taskInputSchema.optional(),
    confirmed: z.literal(true),
  }),
]);
export async function handleTasks(request: Request, repository?: ConversationRepository) {
  try {
    checkLocalConversationRequest(request);
    const db = (repository ?? getConversations()).tasks;
    if (request.method === "GET")
      return Response.json(
        { tasks: db.list(), projects: db.projects() },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (request.method !== "POST") throw new ConversationError("Method not allowed.", 405);
    const parsed = mutation.safeParse(await request.json());
    if (!parsed.success) throw new ConversationError("Review and confirm valid task details.", 400);
    const m = parsed.data;
    if (m.kind === "decide") return Response.json(db.decide(m.id, m.decision, m.task));
    if (m.kind === "save") db.save(m.task, m.id, m.version);
    if (m.kind === "delete") db.remove(m.id, m.version);
    if (m.kind === "project") db.project(m.name, m.id);
    if (m.kind === "deleteProject") db.removeProject(m.id);
    return Response.json({ tasks: db.list(), projects: db.projects() });
  } catch (e) {
    return conversationFailure(e);
  }
}
