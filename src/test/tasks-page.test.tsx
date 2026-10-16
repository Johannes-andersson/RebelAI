import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, afterEach } from "vitest";
import { TasksPage } from "@/components/tasks-page";
import { taskRequest } from "@/lib/tasks";
import { emptyTask, type Task } from "@/lib/task-config";
vi.mock("@/lib/tasks", () => ({ taskRequest: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("sends edited dates and completion only after confirmation and requires delete confirmation", async () => {
  let tasks: Task[] = [
    {
      ...emptyTask("UTC"),
      id: "test",
      title: "Synthetic task",
      createdAt: "now",
      updatedAt: "now",
      version: 1,
    },
  ];
  vi.mocked(taskRequest).mockImplementation(async (body) => {
    if (body) {
      const m = body as { kind: string; task: Task };
      if (m.kind === "save") tasks = [{ ...tasks[0]!, ...m.task }];
      if (m.kind === "delete") tasks = [];
    }
    return { tasks, projects: [] };
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TasksPage />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Edit / complete" }));
  fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-20" } });
  fireEvent.click(screen.getByLabelText("Completed"));
  expect(tasks[0]?.completed).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Confirm task" }));
  await waitFor(() => expect(tasks[0]).toMatchObject({ completed: true, dueDate: "2026-10-20" }));
  fireEvent.change(screen.getByLabelText("status"), { target: { value: "completed" } });
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  expect(tasks).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(tasks).toHaveLength(1);
});
