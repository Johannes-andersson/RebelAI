import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { platform, homedir } from "node:os";
import { win32, posix } from "node:path";
import { canonicalModelTag, isSupportedModel, ollamaModelTags } from "./model-config";

export class ModelServiceError extends Error {
  constructor(
    message: string,
    public status = 503,
    public code = "ollama_unavailable",
  ) {
    super(message);
  }
}

export function ollamaUrl(path: string): URL {
  const base = process.env["OLLAMA_BASE_URL"]?.trim() || "http://127.0.0.1:11434";
  try {
    const url = new URL(`${base.replace(/\/+$/, "")}/api/${path}`);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url;
  } catch {
    throw new ModelServiceError(
      "OLLAMA_BASE_URL must be a valid HTTP or HTTPS URL.",
      500,
      "configuration",
    );
  }
}

export function resolveModelTag(id: string): string {
  if (!isSupportedModel(id)) throw new ModelServiceError("Choose a supported model.", 400, "model");
  const key = `OLLAMA_MODEL_${id.replaceAll("-", "_").toUpperCase()}`;
  return canonicalModelTag(process.env[key]?.trim() || ollamaModelTags[id]!);
}

export async function ollamaConnectionError(): Promise<ModelServiceError> {
  const url = ollamaUrl("tags");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return new ModelServiceError(
      "Cannot reach the configured Ollama server. Check OLLAMA_BASE_URL and that the server is running.",
    );
  }
  const os = platform();
  const paths = os === "win32" ? win32 : posix;
  const executable = os === "win32" ? "ollama.exe" : "ollama";
  const candidates = (process.env["PATH"] || "")
    .split(paths.delimiter)
    .filter(Boolean)
    .map((dir) => paths.join(dir.replace(/^"|"$/g, ""), executable));
  if (os === "darwin") {
    candidates.push(
      "/Applications/Ollama.app/Contents/Resources/ollama",
      posix.join(homedir(), "Applications/Ollama.app/Contents/Resources/ollama"),
    );
  }
  if (os === "win32") {
    if (process.env["LOCALAPPDATA"])
      candidates.push(win32.join(process.env["LOCALAPPDATA"], "Programs", "Ollama", executable));
    if (process.env["ProgramFiles"])
      candidates.push(win32.join(process.env["ProgramFiles"], "Ollama", executable));
  }
  const found = (
    await Promise.all(
      candidates.map(async (path) => {
        try {
          await access(path, os === "win32" ? constants.F_OK : constants.X_OK);
          return true;
        } catch {
          return false;
        }
      }),
    )
  ).some(Boolean);
  return found
    ? new ModelServiceError(
        "Ollama is installed but is not responding. Open the Ollama app or run `ollama serve`, then retry. Check OLLAMA_BASE_URL if it is already running.",
        503,
        "ollama_not_running",
      )
    : new ModelServiceError(
        "Ollama was not found in the usual installation locations. Install Ollama from ollama.com/download and open it. If installed elsewhere, start it and check OLLAMA_BASE_URL.",
        503,
        "ollama_not_found",
      );
}

export function modelErrorResponse(error: unknown): Response {
  const known = error instanceof ModelServiceError;
  return Response.json(
    {
      error: known ? error.message : "The Ollama request failed. Please try again.",
      code: known ? error.code : "ollama_error",
    },
    { status: known ? error.status : 502, headers: { "Cache-Control": "no-store" } },
  );
}
