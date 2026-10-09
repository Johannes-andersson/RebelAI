import type { DatabaseSync } from "node:sqlite";
import { canonicalModelTag } from "./model-config";
import {
  automaticPreferences,
  preferencesSchema,
  performanceSchema,
  type GenerationPreferences,
  type GenerationPerformance,
} from "./generation-config";
export class GenerationRepository {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS model_preferences (tag TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS message_performance (messageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, data TEXT NOT NULL);`);
  }
  get(tag: string): GenerationPreferences {
    const row = this.db
      .prepare("SELECT data FROM model_preferences WHERE tag=?")
      .get(canonicalModelTag(tag));
    return row
      ? preferencesSchema.parse(JSON.parse(String(row["data"])))
      : { ...automaticPreferences };
  }
  set(tag: string, preferences: GenerationPreferences) {
    const parsed = preferencesSchema.parse(preferences);
    const value = parsed.mode === "automatic" ? { ...automaticPreferences } : parsed;
    this.db
      .prepare(
        "INSERT INTO model_preferences VALUES (?,?) ON CONFLICT(tag) DO UPDATE SET data=excluded.data",
      )
      .run(canonicalModelTag(tag), JSON.stringify(value));
    return value;
  }
  savePerformance(id: string, performance: GenerationPerformance) {
    this.db
      .prepare(
        "INSERT INTO message_performance VALUES (?,?) ON CONFLICT(messageId) DO UPDATE SET data=excluded.data",
      )
      .run(id, JSON.stringify(performanceSchema.parse(performance)));
  }
  performance(id: string): GenerationPerformance | undefined {
    const row = this.db.prepare("SELECT data FROM message_performance WHERE messageId=?").get(id);
    if (!row) return undefined;
    const parsed = performanceSchema.safeParse(JSON.parse(String(row["data"])));
    return parsed.success ? parsed.data : undefined;
  }
}
