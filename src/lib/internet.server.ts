import type { DatabaseSync } from "node:sqlite";
import { webSearchSchema, type WebSearch } from "./web-search";
// One instance belongs to the existing conversation database/server connection.
export class InternetRepository {
  private searches = new Set<AbortController>();
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO app_settings VALUES ('internet', 'false');
      CREATE TABLE IF NOT EXISTS message_web_search (
        messageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, data TEXT NOT NULL);`);
  }
  enabled() {
    return (
      this.db.prepare("SELECT value FROM app_settings WHERE key='internet'").get()?.["value"] ===
      "true"
    );
  }
  setEnabled(enabled: boolean) {
    // Stop active network work even if persisting OFF subsequently fails.
    if (!enabled) for (const controller of this.searches) controller.abort();
    this.db
      .prepare(
        "INSERT INTO app_settings VALUES ('internet', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(enabled));
  }
  beginSearch(signal: AbortSignal) {
    if (!this.enabled()) return null;
    const controller = new AbortController();
    this.searches.add(controller);
    return {
      signal: AbortSignal.any([signal, controller.signal]),
      finish: () => this.searches.delete(controller),
    };
  }
  save(messageId: string, search: WebSearch) {
    const data = webSearchSchema.parse(search);
    this.db
      .prepare(
        "INSERT INTO message_web_search VALUES (?,?) ON CONFLICT(messageId) DO UPDATE SET data=excluded.data",
      )
      .run(messageId, JSON.stringify(data));
  }
  get(messageId: string): WebSearch | undefined {
    try {
      const row = this.db
        .prepare("SELECT data FROM message_web_search WHERE messageId=?")
        .get(messageId);
      if (!row) return undefined;
      const parsed = webSearchSchema.safeParse(JSON.parse(String(row["data"])));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }
}
