import { z } from "zod";

export const intentZ = z.enum(["image", "landing-page", "email"]);
export type Intent = z.infer<typeof intentZ>;

export const dispatchInputZ = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(3).max(2000),
  intent: intentZ.optional(),
  parentArtifactId: z.string().uuid().optional(),
  /** Stretch: fan out into N parallel runs sharing one credit hold. */
  count: z.number().int().min(1).max(5).optional(),
});
export type DispatchInput = z.infer<typeof dispatchInputZ>;

export const classifierOutZ = z.object({
  kind: intentZ,
  confidence: z.number().min(0).max(1),
});
export type ClassifierOut = z.infer<typeof classifierOutZ>;

export const creativeContentZ = z.object({
  headline: z.string().min(1),
  body: z.string().min(1),
  ctaLabel: z.string().min(1),
  // Groq's structured-output validator rejects JSON-Schema `format: "uri"`,
  // so we keep this as a plain string and rely on the prompt to keep it sane.
  ctaUrl: z.string().min(1),
});
export type CreativeContent = z.infer<typeof creativeContentZ>;

export const imageArtifactZ = z.object({
  url: z.string().min(1),
});
export type ImageArtifact = z.infer<typeof imageArtifactZ>;

export type ArtifactPayload = CreativeContent | ImageArtifact;
