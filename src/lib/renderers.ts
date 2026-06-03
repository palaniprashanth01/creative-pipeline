import { streamObject } from "ai";
import { groq } from "@ai-sdk/groq";
import {
  creativeContentZ,
  type CreativeContent,
  type ImageArtifact,
} from "./schemas";

export const RENDER_MODEL = "openai/gpt-oss-120b";
export const IMAGE_MODEL = "picsum (placeholder)";

/**
 * Image kind: deterministic placeholder via picsum.photos, seeded by a hash of
 * the prompt so the same prompt always returns the same image. The brief
 * explicitly endorses picsum here ("we want to read the diff, not pay for
 * image gen"). Swap this for HuggingFace / Replicate / OpenAI Images by
 * dropping in an API key — see README.
 */
export function renderImage(args: {
  runId: string;
  prompt: string;
}): ImageArtifact {
  const seed = hashSeed(args.prompt) || args.runId.replace(/-/g, "").slice(0, 10);
  return {
    url: `https://picsum.photos/seed/${encodeURIComponent(seed)}/1024/768`,
  };
}

function hashSeed(s: string): string {
  // Cheap FNV-1a, just enough to derive a stable seed string per prompt.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const SYSTEM_BY_KIND = {
  "landing-page":
    "Generate a punchy landing-page hero. Return JSON {headline, body, ctaLabel, ctaUrl}. Use https://example.com for ctaUrl unless the prompt specifies one.",
  email:
    "Write a short marketing email. headline is the subject line. body is the email body (2-4 sentences). ctaLabel/ctaUrl are the call-to-action.",
} as const;

export async function renderStructured(args: {
  kind: "landing-page" | "email";
  prompt: string;
  onPartial: (partial: Partial<CreativeContent>) => void;
  signal?: AbortSignal;
}): Promise<CreativeContent> {
  const result = streamObject({
    model: groq(RENDER_MODEL),
    schema: creativeContentZ,
    system: SYSTEM_BY_KIND[args.kind],
    prompt: args.prompt,
    abortSignal: args.signal,
  });

  for await (const partial of result.partialObjectStream) {
    args.onPartial(partial);
  }
  return await result.object;
}
