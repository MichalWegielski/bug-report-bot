import { z } from "zod";

export const FinalInfoQualitySchema = z.enum([
  "POSITIVE",
  "NEGATIVE",
  "UNCLEAR",
]);
