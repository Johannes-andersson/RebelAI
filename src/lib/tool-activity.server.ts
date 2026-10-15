import type { DatabaseSync } from "node:sqlite";
import { toolActivitySchema, type ToolActivity } from "./tool-plan";
export class ToolActivityRepository {
  constructor(private db: DatabaseSync) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS message_tool_activity (messageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, data TEXT NOT NULL)",
    );
  }
  set(id: string, activity: ToolActivity[]) {
    const value = toolActivitySchema.array().max(4).parse(activity);
    this.db
      .prepare(
        "INSERT INTO message_tool_activity VALUES (?,?) ON CONFLICT(messageId) DO UPDATE SET data=excluded.data",
      )
      .run(id, JSON.stringify(value));
  }
  get(id: string): ToolActivity[] {
    const row = this.db.prepare("SELECT data FROM message_tool_activity WHERE messageId=?").get(id);
    if (!row) return [];
    return toolActivitySchema.array().parse(JSON.parse(String(row["data"])));
  }
}
