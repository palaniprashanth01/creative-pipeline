import { generateObject } from "ai";
import { groq } from "@ai-sdk/groq";
import { classifierOutZ, type ClassifierOut } from "./schemas";

export const CLASSIFIER_MODEL = "openai/gpt-oss-20b";

const SYSTEM = `You classify an operator's creative-request prompt into exactly one of three kinds:
- "image": pictures, photography, visual stills, illustrations
- "landing-page": web hero / marketing pages, sign-up flows, product pages
- "email": newsletters, marketing emails, transactional emails, announcements

Return JSON: {"kind": <one of the three>, "confidence": <0.0 to 1.0 how certain you are>}.
Be conservative — if the prompt could plausibly fit two kinds, lower the confidence.`;

export async function classify(
  prompt: string,
  signal?: AbortSignal,
): Promise<ClassifierOut> {
  const { object } = await generateObject({
    model: groq(CLASSIFIER_MODEL),
    schema: classifierOutZ,
    system: SYSTEM,
    prompt,
    abortSignal: signal,
  });
  return object;
}
