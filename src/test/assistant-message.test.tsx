import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssistantMessage } from "@/components/assistant-message";
import { CopyButton } from "@/components/copy-button";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("renders headings, emphasis, lists, blockquotes, tables, inline code and rules", () => {
  const { container } = render(
    <AssistantMessage
      content={
        "# Heading\n\n**Bold** and *italic* with `code`.\n\n- Item\n\n> Quote\n\n| A | B |\n| - | - |\n| One | Two |\n\n---"
      }
    />,
  );
  expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
  for (const tag of ["strong", "em", "ul", "blockquote", "table", "code", "hr"])
    expect(container.querySelector(tag)).not.toBeNull();
});
it("copies entire plain Markdown and reports clipboard failure", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const text = "**Bold**\n\n```js\n  const x = 1;\n```";
  render(<CopyButton label="Copy Response" text={text} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy Response" }));
  await screen.findByText("Copied");
  expect(writeText).toHaveBeenCalledWith(text);
  writeText.mockRejectedValueOnce(new Error("denied"));
  fireEvent.click(screen.getByRole("button", { name: "Copy Response" }));
  expect(await screen.findByText(/Could not copy/)).toBeInTheDocument();
});
it("preserves indentation and language and copies fenced code only", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { container } = render(
    <AssistantMessage content={"Before\n\n```python\ndef test():\n    return 1\n```"} />,
  );
  expect(screen.getByText("python")).toBeInTheDocument();
  expect(container.querySelector("pre code")?.textContent).toBe("def test():\n    return 1");
  fireEvent.click(screen.getByRole("button", { name: "Copy Code" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("def test():\n    return 1"));
});
it("never executes HTML, unsafe links, or remote images", () => {
  const { container } = render(
    <AssistantMessage
      content={
        "<script>alert(1)</script>\n\n[bad](javascript:alert%281%29) [data](data:text/html,evil) [safe](https://example.org)\n\n![track](https://evil.example/pixel)\n\n<img src=x onerror=alert(1)>"
      }
    />,
  );
  expect(container.querySelector("script, img")).toBeNull();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.org");
});
it("keeps streaming incomplete fences readable and validates web references without damaging code", () => {
  const search = {
    status: "complete" as const,
    notice: "Snippets",
    sources: [{ id: "S1", title: "Source", url: "https://example.org", snippet: "Result" }],
  };
  const view = render(
    <AssistantMessage content={"Evidence [S1] [S9]\n\n```js\narr[0]"} search={search} />,
  );
  expect(view.container.querySelector("pre")?.textContent).toBe("arr[0]");
  expect(screen.getByText(/unsupported reference/)).toBeInTheDocument();
  view.rerender(
    <AssistantMessage
      content={"Evidence [S1]\n\n```js\narr[0] = 1;\n```\n\n[invented](https://evil.example)"}
      search={search}
    />,
  );
  expect(view.container.querySelector("pre")?.textContent).toBe("arr[0] = 1;");
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
