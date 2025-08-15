import { z } from "zod";

export const ReportSchema = z.object({
  title: z.string().describe("Zwięzły, techniczny tytuł błędu."),
  environment: z.object({
    url: z.string().optional(),
    browser: z.string().optional(),
    os: z.string().optional(),
  }),
  stepsToReproduce: z
    .array(z.string())
    .describe("Lista kroków do odtworzenia błędu."),
  expectedResult: z.string(),
  actualResult: z.string(),
  technicalAnalysis: z
    .string()
    .describe("Twoja krótka, techniczna analiza problemu."),
});
