import { DocumentError } from "./document-config";
import { localOllamaUrl, requireLocalModel } from "./embeddings.server";
export function validateImage(data: Uint8Array, type: string) {
  const b = Buffer.from(data);
  const valid =
    type === "png"
      ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : type === "jpg"
        ? b[0] === 255 && b[1] === 216 && b[2] === 255
        : b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
  if (!valid) throw new DocumentError("The image contents do not match its file type.");
  // Bound decoded dimensions where present. Originals remain unchanged for useful detail.
  if (type === "png" && b.length >= 24 && b.readUInt32BE(16) * b.readUInt32BE(20) > 40_000_000)
    throw new DocumentError("This image is too large. Resize it to at most 40 megapixels.");
}
export async function requireVision(model: string, signal: AbortSignal) {
  await requireLocalModel(model, signal);
  const response = await fetch(localOllamaUrl("show"), {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.capabilities) || !data.capabilities.includes("vision"))
    throw new DocumentError(
      "The selected model does not report image understanding. Select an installed local vision model, or remove the images. No image was analyzed.",
      400,
    );
}
