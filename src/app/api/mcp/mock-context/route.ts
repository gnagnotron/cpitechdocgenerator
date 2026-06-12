import { NextResponse } from "next/server";

type MCPContextRequest = {
  language?: string;
  documentName?: string;
  templateId?: string;
  markdown?: string;
};

const pickTopSignals = (markdown: string) => {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const bullets = lines.filter((line) => line.startsWith("-") || line.startsWith("*"));
  const headings = lines.filter((line) => line.startsWith("##") || line.startsWith("###"));

  return {
    bullets: bullets.slice(0, 4),
    headings: headings.slice(0, 4),
  };
};

export async function POST(request: Request) {
  const body = (await request.json()) as MCPContextRequest;
  const language = body.language ?? "it";
  const templateId = body.templateId ?? "unknown";
  const documentName = body.documentName ?? "document";
  const markdown = body.markdown ?? "";

  const { bullets, headings } = pickTopSignals(markdown);

  const context = [
    `Language=${language}`,
    `Template=${templateId}`,
    `Document=${documentName}`,
    "Focus on operational handover clarity and measurable controls.",
    headings.length > 0 ? `Key headings: ${headings.join(" | ")}` : "Key headings: n/a",
    bullets.length > 0 ? `Key bullets: ${bullets.join(" | ")}` : "Key bullets: n/a",
  ].join("\n");

  return NextResponse.json({
    context,
    notes: [
      "Prioritize checks that reduce production incidents.",
      "Call out assumptions explicitly when source data is incomplete.",
      "Prefer concrete monitoring signals over generic recommendations.",
    ],
  });
}
