import { MAX_CHANGES, MAX_INSTALLMENTS, MAX_REPEAT } from "@neko/engine";
import { z } from "zod";

const Money = z.number().int().positive().max(100_000_000_00);

/**
 * What Simular asks (web and Android). Both fields may be left out: the Android app's JSON leaves
 * out values equal to their default, so opening Simular sends `{}` and choosing a pace sends only
 * the pace. Left out, the pace is the ceiling when there is one, else the sheet as it is.
 */
export const ScenarioBody = z.object({
  pace: z.enum(["planilha", "teto", "media"]).optional(),
  changes: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("compra"),
          amount: Money,
          count: z.number().int().min(1).max(MAX_INSTALLMENTS),
        }),
        z.object({
          kind: z.enum(["entrada", "saida"]),
          amount: Money,
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          months: z.number().int().min(1).max(MAX_REPEAT),
        }),
      ]),
    )
    .max(MAX_CHANGES)
    .default([]),
});
