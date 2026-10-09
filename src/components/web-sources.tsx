import { identifiedSources, webSearchSchema, type WebSearch } from "@/lib/web-search";
export function WebSources({ search }: { search: WebSearch | undefined }) {
  const parsed = webSearchSchema.safeParse(search);
  if (!parsed.success) return null;
  const value = parsed.data;
  return (
    <div className="mt-3 text-xs text-muted-foreground" aria-label="Web search">
      <p role={value.status === "searching" ? "status" : undefined}>
        {value.notice}
        {value.status === "complete" && value.searchedAt
          ? ` · ${value.searchedAt.slice(0, 10)}`
          : ""}
      </p>
      {value.status === "complete" && (
        <p>Search snippets only. Full pages were not retrieved; references are not fact checks.</p>
      )}
      {value.status === "complete" && (
        <ol className="mt-2 space-y-1">
          {identifiedSources(value.sources).map((source) => (
            <li key={source.url}>
              <a
                className="link-quiet break-words"
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                [{source.id}] {source.title}
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
