import type { StructuredWarning } from "./types.ts";

export const logWarning = (warning: StructuredWarning) => {
  console.warn(
    JSON.stringify({
      level: "warn",
      ts: new Date().toISOString(),
      ...warning,
    }),
  );
};

export const logAIEvent = (event: Record<string, unknown>) => {
  console.info(
    JSON.stringify({
      level: "info",
      ts: new Date().toISOString(),
      kind: "ai-audit",
      ...event,
    }),
  );
};
