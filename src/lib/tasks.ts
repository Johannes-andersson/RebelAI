import type { Task, Project } from "./task-config";
export async function taskRequest(body?: unknown): Promise<{ tasks: Task[]; projects: Project[] }> {
  const response = await fetch("/api/tasks", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not access local tasks.");
  return data;
}
