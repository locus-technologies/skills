import { z } from 'zod';

// Everything on screen comes from props built from a real eval run
// (scripts/build-props.mjs). Nothing here is typed in by hand.
export const launchSchema = z.object({
  pack: z.string(),
  hook: z.string(),
  incumbent: z.object({ name: z.string(), price: z.string(), unit: z.string() }),
  ours: z.object({ cost: z.string(), unit: z.string() }),
  prompt: z.string(),
  steps: z.array(z.object({ tool: z.string(), detail: z.string(), credits: z.number().nullable() })),
  columns: z.array(z.string()).length(3),
  rows: z.array(z.array(z.string()).length(3)),
  summary: z.array(z.object({ value: z.string(), label: z.string() })),
  install: z.string(),
  repo: z.string(),
});

export type LaunchProps = z.infer<typeof launchSchema>;
