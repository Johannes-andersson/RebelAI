import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { taskRequest } from "@/lib/tasks";
import { emptyTask, filterTasks, type TaskInput, type Task, type Project } from "@/lib/task-config";
export function TaskFields({
  value,
  onChange,
  projects,
}: {
  value: TaskInput;
  onChange: (v: TaskInput) => void;
  projects: Project[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      {(
        [
          ["title", "Title"],
          ["description", "Description"],
          ["notes", "Notes"],
        ] as const
      ).map(([key, label]) => (
        <label className="col-span-2" key={key}>
          {label}
          <input
            className="mt-1 w-full rounded border border-border bg-background p-2"
            value={value[key]}
            maxLength={key === "title" ? 200 : 4000}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          />
        </label>
      ))}
      <label>
        Priority
        <select
          className="block w-full bg-background p-2"
          value={value.priority}
          onChange={(e) =>
            onChange({ ...value, priority: e.target.value as TaskInput["priority"] })
          }
        >
          {["low", "medium", "high"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label>
        Project
        <select
          className="block w-full bg-background p-2"
          value={value.projectId ?? ""}
          onChange={(e) => onChange({ ...value, projectId: e.target.value || null })}
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due date
        <input
          className="block w-full bg-background p-2"
          type="date"
          value={value.dueDate}
          onChange={(e) => onChange({ ...value, dueDate: e.target.value })}
        />
      </label>
      <label>
        Due time (optional)
        <input
          className="block w-full bg-background p-2"
          type="time"
          value={value.dueTime}
          onChange={(e) => onChange({ ...value, dueTime: e.target.value })}
        />
      </label>
      <label className="col-span-2">
        Time zone
        <input
          className="block w-full bg-background p-2"
          value={value.timeZone}
          onChange={(e) => onChange({ ...value, timeZone: e.target.value })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.completed}
          onChange={(e) => onChange({ ...value, completed: e.target.checked })}
        />{" "}
        Completed
      </label>
    </div>
  );
}
export function TasksPage() {
  const client = useQueryClient(),
    query = useQuery({ queryKey: ["tasks"], queryFn: () => taskRequest() });
  const [draft, setDraft] = useState<TaskInput | null>(null),
    [editing, setEditing] = useState<Task | null>(null);
  const [filter, setFilter] = useState({
    status: "active",
    priority: "",
    project: "",
    due: "",
    sort: "due",
  });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState<Task | null>(null);
  const [projectName, setProjectName] = useState(""),
    [projectId, setProjectId] = useState(""),
    [deleteProject, setDeleteProject] = useState<Project | null>(null);
  const [newId, setNewId] = useState("");
  async function mutate(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await taskRequest(body);
      await client.invalidateQueries({ queryKey: ["tasks"] });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="overflow-auto p-8 space-y-5">
      <div className="flex gap-3">
        <button
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setNewId(crypto.randomUUID());
            setDraft(emptyTask(Intl.DateTimeFormat().resolvedOptions().timeZone));
          }}
        >
          New task
        </button>
        <button className="btn-secondary" onClick={() => void query.refetch()}>
          Refresh
        </button>
      </div>
      {(error || query.error) && <p role="alert">{error || query.error?.message}</p>}
      <div className="flex flex-wrap gap-3">
        {(["status", "priority", "due", "sort"] as const).map((key) => (
          <label key={key}>
            {key}
            <select
              className="ml-2 bg-panel p-2"
              value={filter[key]}
              onChange={(e) => setFilter({ ...filter, [key]: e.target.value })}
            >
              {(key === "status"
                ? ["active", "completed", "all"]
                : key === "priority"
                  ? ["", "low", "medium", "high"]
                  : key === "due"
                    ? ["", "overdue", "upcoming"]
                    : ["due", "priority", "created"]
              ).map((v) => (
                <option key={v} value={v}>
                  {v || "all"}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Project
          <select
            className="ml-2 bg-panel p-2"
            value={filter.project}
            onChange={(e) => setFilter({ ...filter, project: e.target.value })}
          >
            <option value="">All projects</option>
            {query.data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="space-y-2">
        {filterTasks(query.data?.tasks ?? [], filter).map((t) => (
          <li key={t.id} className="rounded-xl border border-border p-4 flex justify-between gap-4">
            <div>
              <p className="font-medium">{t.title}</p>
              <p className="text-sm text-muted-foreground">
                {t.priority} · {t.completed ? "Completed" : "Open"}{" "}
                {t.dueDate && `· ${t.dueDate} ${t.dueTime} (${t.timeZone})`}
              </p>
              <p className="text-sm">{t.description}</p>
            </div>
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                onClick={() => {
                  const { id: _id, version: _v, createdAt: _c, updatedAt: _u, ...input } = t;
                  setEditing(t);
                  setDraft(input);
                }}
              >
                Edit / complete
              </button>
              <button className="btn-secondary" onClick={() => setDeleting(t)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {draft && (
        <form
          className="rounded-xl border border-border bg-panel p-5 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await mutate({
                kind: "save",
                id: editing?.id ?? newId,
                task: draft,
                ...(editing ? { version: editing.version } : {}),
                confirmed: true,
              })
            )
              setDraft(null);
          }}
        >
          <h2>{editing ? "Edit task" : "Create task"}</h2>
          <TaskFields value={draft} onChange={setDraft} projects={query.data?.projects ?? []} />
          <button disabled={busy} className="btn-primary">
            Confirm task
          </button>
          <button type="button" className="btn-secondary ml-2" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </form>
      )}
      {deleting && (
        <section
          role="dialog"
          aria-label="Delete task"
          className="rounded-xl border border-border p-5"
        >
          <p>Delete “{deleting.title}” permanently?</p>
          <button
            disabled={busy}
            className="btn-primary"
            onClick={async () => {
              if (
                await mutate({
                  kind: "delete",
                  id: deleting.id,
                  version: deleting.version,
                  confirmed: true,
                })
              )
                setDeleting(null);
            }}
          >
            Confirm deletion
          </button>
          <button className="btn-secondary" onClick={() => setDeleting(null)}>
            Cancel
          </button>
        </section>
      )}
      <details className="rounded-xl border border-border p-4">
        <summary>Manage projects</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await mutate({
                kind: "project",
                id: projectId || crypto.randomUUID(),
                name: projectName,
                confirmed: true,
              })
            ) {
              setProjectName("");
              setProjectId("");
            }
          }}
          className="my-3 flex gap-2"
        >
          <input
            aria-label="Project name"
            className="bg-panel p-2"
            required
            maxLength={100}
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
          <button disabled={busy} className="btn-primary">
            {projectId ? "Rename project" : "Create project"}
          </button>
        </form>
        {query.data?.projects.map((p) => (
          <div key={p.id} className="flex gap-3 my-2">
            {p.name}
            <button
              onClick={() => {
                setProjectName(p.name);
                setProjectId(p.id);
              }}
            >
              Rename
            </button>
            <button onClick={() => setDeleteProject(p)}>Delete</button>
          </div>
        ))}
        {deleteProject && (
          <div role="dialog">
            <p>Delete project “{deleteProject.name}”? Tasks will be kept without a project.</p>
            <button
              disabled={busy}
              onClick={async () => {
                if (await mutate({ kind: "deleteProject", id: deleteProject.id, confirmed: true }))
                  setDeleteProject(null);
              }}
            >
              Confirm project deletion
            </button>
            <button onClick={() => setDeleteProject(null)}>Cancel</button>
          </div>
        )}
      </details>
    </div>
  );
}
