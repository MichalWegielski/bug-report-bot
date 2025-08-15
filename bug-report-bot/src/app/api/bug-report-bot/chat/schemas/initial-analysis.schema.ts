import { z } from "zod";

export const InitialAnalysisSchema = z.object({
  assessment: z.enum(["good", "bad"]),
  summary: z.string(),
});
