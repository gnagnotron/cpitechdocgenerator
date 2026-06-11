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
