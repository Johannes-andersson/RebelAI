import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { InternetSetting } from "@/components/internet-setting";
import { WebSources } from "@/components/web-sources";
import { internet } from "@/lib/internet";
vi.mock("@/lib/internet", () => ({ internet: { get: vi.fn(), set: vi.fn() } }));
let enabled = false;
const clients: QueryClient[] = [];
function ui() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return (
    <QueryClientProvider client={client}>
      <InternetSetting />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  enabled = false;
  vi.resetAllMocks();
  vi.mocked(internet.get).mockImplementation(async () => ({ enabled }));
  vi.mocked(internet.set).mockImplementation(async (value) => ({ enabled: (enabled = value) }));
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
});
it("hydrates from server-owned state and survives navigation/remount and a fresh cache", async () => {
  const first = render(ui());
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  expect(screen.getByRole("switch")).not.toBeChecked();
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
  first.unmount();
  render(ui());
  await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() => expect(screen.getByRole("switch")).not.toBeChecked());
  expect(enabled).toBe(false);
});
it("renders safely on the server without fetching or reading localStorage", () => {
  const html = renderToString(ui());
  expect(html).toContain("Allow internet access");
  expect(html).toContain('aria-checked="false"');
  expect(internet.get).not.toHaveBeenCalled();
});
it("shows persistence failures instead of pretending a change was saved", async () => {
  vi.mocked(internet.set).mockRejectedValueOnce(new Error("Could not save internet permission."));
  render(ui());
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  fireEvent.click(screen.getByRole("switch"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
  expect(screen.getByRole("switch")).not.toBeChecked();
});
it("renders only validated source URLs and does not execute snippet markup", () => {
  const source = {
    title: "Official release",
    url: "https://example.org/release",
    snippet: "<script>attack()</script>",
  };
  const page = render(
    <WebSources search={{ status: "complete", notice: "Web sources", sources: [source] }} />,
  );
  expect(screen.getByRole("link")).toHaveAttribute("href", source.url);
  expect(screen.getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
  page.rerender(
    <WebSources
      search={{
        status: "complete",
        notice: "Web sources",
        sources: [{ ...source, url: "javascript:attack()" }],
      }}
    />,
  );
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
