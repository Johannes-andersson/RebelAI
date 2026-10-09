import type { StoredMessage } from "@/lib/types";
export function GenerationPerformance({ message }: { message: StoredMessage }) {
  const p = message.performance;
  if (!p) return null;
  return (
    <details className="mt-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer">Response performance</summary>
      <div className="mt-2 space-y-1">
        <p>Model used: {p.modelTag}</p>
        <p>
          Status:{" "}
          {message.status === "interrupted"
            ? "Cancelled or interrupted"
            : message.status === "error"
              ? "Failed"
              : message.status === "pending"
                ? "In progress"
                : "Completed"}
        </p>
        <p>
          Measured request duration: {(p.elapsedMs / 1000).toFixed(2)} seconds (includes model
          inspection/loading; excludes web search).
        </p>
        {p.runtimeMs !== undefined && (
          <p>Ollama-reported generation duration: {(p.runtimeMs / 1000).toFixed(2)} seconds.</p>
        )}
        {p.tokensPerSecond !== undefined && (
          <p>
            Measured generation speed: {p.tokensPerSecond.toFixed(1)} tokens/second (Ollama token
            count ÷ evaluation time).
          </p>
        )}
        {p.outputTokens !== undefined && <p>Ollama-reported output tokens: {p.outputTokens}.</p>}
        {p.promptTokens !== undefined && <p>Ollama-reported prompt tokens: {p.promptTokens}.</p>}
        {p.options && (
          <p>
            Requested context: {p.options.num_ctx}; maximum output: {p.options.num_predict};
            temperature: {p.options.temperature ?? "model default"}; top-p:{" "}
            {p.options.top_p ?? "model default"}.
          </p>
        )}
        {p.estimatedPromptTokens !== undefined && (
          <p>
            Estimated prompt tokens: {p.estimatedPromptTokens} (includes supporting context;
            tokenizer-dependent estimate).
          </p>
        )}
        {!!p.omittedMessages && (
          <p>
            {p.omittedMessages} older messages omitted from this request to fit the context budget.
            Saved history is unchanged.
          </p>
        )}
      </div>
    </details>
  );
}
