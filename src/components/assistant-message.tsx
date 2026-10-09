import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Children, isValidElement, type ReactNode } from "react";
import { CopyButton } from "./copy-button";
import { safeWebUrl, webAnswerText, type WebSearch } from "@/lib/web-search";

function CodeBlock({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children)[0];
  const props = isValidElement<{ children?: ReactNode; className?: string }>(child)
    ? child.props
    : undefined;
  const text = String(props?.children ?? "").replace(/\n$/, "");
  const language = /language-([^\s]+)/.exec(props?.className ?? "")?.[1] ?? "Code";
  return (
    <div className="my-4 min-w-0 overflow-hidden rounded-lg border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-1 text-xs text-muted-foreground">
        <span>{language}</span>
        <CopyButton label="Copy Code" text={text} />
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function AssistantMessage({
  content,
  search,
}: {
  content: string;
  search?: WebSearch | undefined;
}) {
  // Source validation runs before Markdown, and web-answer links are disabled
  // even if an unusual Markdown construct survives the text filter.
  const text = webAnswerText(content, search);
  return (
    <div className="min-w-0 break-words leading-relaxed text-foreground/90 [&_p]:my-3 [&_h1]:my-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:my-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:my-3 [&_h3]:font-semibold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_hr]:my-5 [&_hr]:border-border">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => (!search && safeWebUrl(url) ? url : "")}
        components={{
          pre: CodeBlock,
          code: ({ children }) => (
            <code className="rounded bg-panel-raised px-1 font-mono text-sm">{children}</code>
          ),
          a: ({ href, children }) =>
            href && !search && safeWebUrl(href) ? (
              <a
                className="link-quiet underline"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : "[Image omitted]"}</span>,
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-panel px-3 py-2 text-left">{children}</th>
          ),
          td: ({ children }) => <td className="border border-border px-3 py-2">{children}</td>,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
