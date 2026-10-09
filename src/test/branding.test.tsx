import { render, screen, cleanup } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}));
vi.mock("@/hooks/use-conversations", () => ({
  useConversations: () => ({ recent: { data: [] }, create: {}, remove: {}, rename: {} }),
}));
afterEach(cleanup);
it("brands the shell Rebel AI and exposes the Calendar navigation alongside existing pages", () => {
  render(
    <AppShell>
      <p>Content</p>
    </AppShell>,
  );
  expect(screen.getByText("REBEL AI")).toBeInTheDocument();
  expect(screen.queryByText(/Lovable/i)).toBeNull();
  for (const label of ["Chats", "Models", "Files", "Calendar", "Settings"])
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute("href", "/calendar");
});
