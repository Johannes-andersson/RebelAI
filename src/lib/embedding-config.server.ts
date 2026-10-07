import { canonicalModelTag } from "./model-config";
// Internal dependency: never use this tag as a conversational model.
export function embeddingModel() {
  return canonicalModelTag(process.env["OLLAMA_EMBEDDING_MODEL"]?.trim() || "embeddinggemma:300m");
}
