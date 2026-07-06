import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  audio_base64: z.string().min(100),
  mime: z.string().default("audio/webm"),
});

function extFromMime(mime: string): string {
  const m = mime.split(";")[0].trim();
  if (m === "audio/webm") return "webm";
  if (m === "audio/mp4" || m === "audio/x-m4a" || m === "audio/m4a") return "m4a";
  if (m === "audio/mpeg" || m === "audio/mp3") return "mp3";
  if (m === "audio/wav" || m === "audio/x-wav") return "wav";
  if (m === "audio/ogg") return "ogg";
  return "webm";
}

/**
 * Transcribe an uploaded audio clip via Lovable AI Gateway (OpenAI-compatible STT).
 * The audio bytes are passed inline as base64 to keep the flow simple.
 */
export const transcribeAudio = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) => Input.parse(v))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    // Decode base64 -> bytes
    const bin = atob(data.audio_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = extFromMime(data.mime);
    const file = new File([bytes], `recording.${ext}`, { type: data.mime });

    const form = new FormData();
    form.append("model", "openai/gpt-4o-mini-transcribe");
    form.append("file", file);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Rate limit reached, please retry in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted for this workspace.");
      throw new Error(`Transcription failed (${res.status}): ${text}`);
    }
    const json = (await res.json()) as { text?: string };
    const text = (json.text ?? "").trim();
    return { text };
  });
