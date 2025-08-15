import { z } from "zod";

export const ScreenshotTriageSchema = z.object({
  classification: z.enum([
    "NEGATIVE",
    "AFFIRMATIVE",
    "ADDITIONAL_INFO",
    "UNCLEAR",
  ]),
  summary: z.string(),
});
