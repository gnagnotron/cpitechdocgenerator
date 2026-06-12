import { setTimeout as delay } from "node:timers/promises";
import { logAIEvent } from "./logger.ts";
import type { AIEnhancementReport, GeneratedDocument, GenerationMode, LanguageCode, LocaleMessages } from "./types.ts";

const AI_TIMEOUT_MS = 30_000;
const JSON_HEADERS = { "Content-Type": "application/json" };
const MCP_TIMEOUT_MS = Number.parseInt(process.env.MCP_CONTEXT_TIMEOUT_MS || "2500", 10);

const hasGroq = () => Boolean(process.env.GROQ_API_KEY);
const hasOpenAI = () => Boolean(process.env.OPENAI_API_KEY);
const hasAnthropic = () => Boolean(process.env.ANTHROPIC_API_KEY);
const hasOllama = () => process.env.OLLAMA_ENABLED === "true";
const hasMCPContext = () => process.env.MCP_ENABLED === "true" && Boolean(process.env.MCP_CONTEXT_ENDPOINT);

const canUseAI = () => hasGroq() || hasOpenAI() || hasAnthropic() || hasOllama();

export const getAIConfigurationStatus = () => ({
  configured: canUseAI(),
  providers: {
    groq: hasGroq(),
    openai: hasOpenAI(),
    anthropic: hasAnthropic(),
    ollama: hasOllama(),
  },
});

const fallbackReport = (reason?: string): AIEnhancementReport => ({
  enabled: false,
  provider: "deterministic-fallback",
  model: "none",
  fallbackReason: reason,
  durationMs: 0,
  promptTokensApprox: 0,
  completionTokensApprox: 0,
});

const timed = async <T>(promise: Promise<T>) =>
  Promise.race<T>([
    promise,
    delay(AI_TIMEOUT_MS).then(() => {
      throw new Error("AI timeout exceeded");
    }),
  ]);

type AIResponse = {
  provider: string;
  model: string;
  text: string;
  promptTokensApprox: number;
  completionTokensApprox: number;
};

const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

const extractMCPContextText = (payload: unknown) => {
  if (typeof payload === "string") {
    return payload.trim();
  }

  if (typeof payload !== "object" || payload === null) {
    return "";
  }

  const data = payload as {
    context?: unknown;
    text?: unknown;
    notes?: unknown;
  };

  if (typeof data.context === "string" && data.context.trim()) {
    return data.context.trim();
  }

  if (typeof data.text === "string" && data.text.trim()) {
    return data.text.trim();
  }

  if (Array.isArray(data.notes)) {
    const notes = data.notes.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (notes.length > 0) {
      return notes.map((note) => `- ${note}`).join("\n");
    }
  }

  return "";
};

const getMCPContext = async (document: GeneratedDocument, language: LanguageCode) => {
  if (!hasMCPContext()) {
    return "";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      ...JSON_HEADERS,
    };
    if (process.env.MCP_AUTH_TOKEN) {
      headers.Authorization = `Bearer ${process.env.MCP_AUTH_TOKEN}`;
    }

    const response = await fetch(process.env.MCP_CONTEXT_ENDPOINT ?? "", {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        language,
        documentName: document.name,
        templateId: document.templateId,
        markdown: document.markdown,
      }),
    });

    if (!response.ok) {
      return "";
    }

    const payload = (await response.json()) as unknown;
    return extractMCPContextText(payload);
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
};

const parseErrorMessage = (raw: string) => {
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string };
      message?: string;
    };
    return parsed.error?.message || parsed.message || raw;
  } catch {
    return raw;
  }
};

const parseRetryAfterSeconds = (retryAfterHeader: string | null) => {
  if (!retryAfterHeader) {
    return null;
  }
  const asNumber = Number(retryAfterHeader);
  if (!Number.isNaN(asNumber) && asNumber >= 0) {
    return asNumber;
  }
  const retryDate = Date.parse(retryAfterHeader);
  if (Number.isNaN(retryDate)) {
    return null;
  }
  return Math.max(0, Math.ceil((retryDate - Date.now()) / 1000));
};

const buildPrompt = (document: GeneratedDocument, locale: LocaleMessages, language: LanguageCode) => {
  const narrativePrompt = locale.docs.text.aiNarrativePrompt;
  const bestPracticesPrompt = locale.docs.text.aiBestPracticesPrompt;
  const testCasesPrompt = locale.docs.text.aiTestCasesPrompt;

  return [
    `Language: ${language}`,
    `Document template: ${document.templateId ?? document.name}`,
    "Task: produce an AI addendum with non-obvious, actionable insights derived from the source document.",
    "Do not rewrite the whole source document and do not repeat it verbatim.",
    "Output format (Markdown):",
    "## Strategic Insights",
    "- 5 to 8 bullets with technical/operational implications.",
    "## Risks and Mitigations",
    "- Table with columns: Risk | Trigger | Mitigation | Monitoring signal.",
    "## Advanced Test Scenarios",
    "- At least 6 realistic end-to-end and edge-case scenarios.",
    "Only use facts inferable from the source document. If data is missing, state explicit assumptions.",
    narrativePrompt,
    bestPracticesPrompt,
    testCasesPrompt,
    "Return valid Markdown only.",
    "Preserve all factual values already present in the document.",
    "Do not invent systems, file names, adapters or business rules not present in the source.",
    "Document to improve:",
    document.markdown,
  ].join("\n\n");
};

const appendMCPContextToPrompt = (prompt: string, mcpContext: string) => {
  if (!mcpContext.trim()) {
    return prompt;
  }
  return [
    prompt,
    "Additional context from optional MCP tools:",
    mcpContext,
    "Use this context only if it is consistent with the source document.",
  ].join("\n\n");
};

const aiAddendumTitleByLanguage: Record<LanguageCode, string> = {
  it: "## Addendum AI",
  en: "## AI Addendum",
  fr: "## Addendum IA",
  de: "## KI-Addendum",
};

const mergeWithAIAddendum = (baseMarkdown: string, aiMarkdown: string, language: LanguageCode) => {
  const cleaned = aiMarkdown.trim().replace(/^```markdown\s*/i, "").replace(/```\s*$/i, "").trim();
  if (!cleaned) {
    return baseMarkdown;
  }
  return `${baseMarkdown}\n\n${aiAddendumTitleByLanguage[language]}\n\n${cleaned}`;
};

const callGroq = async (prompt: string): Promise<AIResponse> => {
  const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const maxRetries = Number.parseInt(process.env.GROQ_MAX_RETRIES || "2", 10);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: "You improve technical documentation without fabricating missing facts." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = payload.choices?.[0]?.message?.content?.trim();
      if (!text) {
        throw new Error("Groq returned empty content");
      }

      return {
        provider: "groq",
        model,
        text,
        promptTokensApprox: payload.usage?.prompt_tokens ?? estimateTokens(prompt),
        completionTokensApprox: payload.usage?.completion_tokens ?? estimateTokens(text),
      };
    }

    const rawError = await response.text();
    const errorMessage = parseErrorMessage(rawError);
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = parseRetryAfterSeconds(response.headers.get("retry-after"));
      const backoffMs = retryAfter ? retryAfter * 1000 : (attempt + 1) * 1500;
      await delay(backoffMs);
      continue;
    }

    throw new Error(`Groq request failed: ${response.status}${errorMessage ? ` - ${errorMessage}` : ""}`);
  }

  throw new Error("Groq request failed after retries");
};

const callOpenAI = async (prompt: string): Promise<AIResponse> => {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: "You improve technical documentation without fabricating missing facts." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("OpenAI returned empty content");
  }

  return {
    provider: "openai",
    model,
    text,
    promptTokensApprox: payload.usage?.prompt_tokens ?? estimateTokens(prompt),
    completionTokensApprox: payload.usage?.completion_tokens ?? estimateTokens(text),
  };
};

const callAnthropic = async (prompt: string): Promise<AIResponse> => {
  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1400,
      temperature: 0.2,
      system: "You improve technical documentation without fabricating missing facts.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic request failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = payload.content?.find((item) => item.type === "text")?.text?.trim();
  if (!text) {
    throw new Error("Anthropic returned empty content");
  }

  return {
    provider: "anthropic",
    model,
    text,
    promptTokensApprox: payload.usage?.input_tokens ?? estimateTokens(prompt),
    completionTokensApprox: payload.usage?.output_tokens ?? estimateTokens(text),
  };
};

const callOllama = async (prompt: string): Promise<AIResponse> => {
  const model = process.env.OLLAMA_MODEL || "mistral";
  const host = process.env.OLLAMA_HOST || "http://localhost:11434";
  const response = await fetch(`${host}/api/generate`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    response?: string;
    prompt_eval_count?: number;
    eval_count?: number;
  };
  const text = payload.response?.trim();
  if (!text) {
    throw new Error("Ollama returned empty content");
  }

  return {
    provider: "ollama",
    model,
    text,
    promptTokensApprox: payload.prompt_eval_count ?? estimateTokens(prompt),
    completionTokensApprox: payload.eval_count ?? estimateTokens(text),
  };
};

const callPreferredProvider = async (prompt: string): Promise<AIResponse> => {
  const providers: Array<{ name: string; run: () => Promise<AIResponse> }> = [];

  if (hasGroq()) {
    providers.push({ name: "groq", run: () => callGroq(prompt) });
  }
  if (hasOpenAI()) {
    providers.push({ name: "openai", run: () => callOpenAI(prompt) });
  }
  if (hasAnthropic()) {
    providers.push({ name: "anthropic", run: () => callAnthropic(prompt) });
  }
  if (hasOllama()) {
    providers.push({ name: "ollama", run: () => callOllama(prompt) });
  }

  const failures: string[] = [];
  for (const provider of providers) {
    try {
      return await provider.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown provider error";
      failures.push(`${provider.name}: ${message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join(" | "));
  }

  throw new Error("No AI providers available");
};

const enhanceDocumentWithAI = async (
  document: GeneratedDocument,
  locale: LocaleMessages,
  language: LanguageCode,
) => {
  const mcpContext = await getMCPContext(document, language);
  const prompt = appendMCPContextToPrompt(buildPrompt(document, locale, language), mcpContext);
  const response = await callPreferredProvider(prompt);
  return {
    document: {
      ...document,
      markdown: mergeWithAIAddendum(document.markdown, response.text, language),
    },
    response,
  };
};

export class AIDocumentEnhancer {
  async enhanceDocuments(
    documents: GeneratedDocument[],
    locale: LocaleMessages,
    language: LanguageCode,
    mode: GenerationMode,
  ): Promise<{ documents: GeneratedDocument[]; report: AIEnhancementReport }> {
    if (mode !== "ai-enhanced") {
      return { documents, report: fallbackReport("AI mode not requested") };
    }

    if (!canUseAI()) {
      return { documents, report: fallbackReport("No AI provider configured") };
    }

    const startedAt = Date.now();
    try {
      const enhancedDocs = await timed(Promise.all(documents.map((document) => enhanceDocumentWithAI(document, locale, language))));
      const firstResponse = enhancedDocs[0]?.response;
      const report: AIEnhancementReport = {
        enabled: true,
        provider: firstResponse?.provider ?? "unknown",
        model: firstResponse?.model ?? "unknown",
        durationMs: Date.now() - startedAt,
        promptTokensApprox: enhancedDocs.reduce((total, item) => total + item.response.promptTokensApprox, 0),
        completionTokensApprox: enhancedDocs.reduce((total, item) => total + item.response.completionTokensApprox, 0),
      };

      logAIEvent({
        language,
        mode,
        provider: report.provider,
        model: report.model,
        durationMs: report.durationMs,
      });

      return { documents: enhancedDocs.map((item) => item.document), report };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown AI error";
      logAIEvent({
        language,
        mode,
        provider: hasGroq() ? "groq" : hasOpenAI() ? "openai" : hasAnthropic() ? "anthropic" : "ollama",
        fallbackReason: reason,
      });
      return { documents, report: fallbackReport(reason) };
    }
  }
}
