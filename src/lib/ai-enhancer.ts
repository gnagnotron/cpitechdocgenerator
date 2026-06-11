import { setTimeout as delay } from "node:timers/promises";
import { logAIEvent } from "./logger.ts";
import type { AIEnhancementReport, GeneratedDocument, GenerationMode, LanguageCode, LocaleMessages } from "./types.ts";

const AI_TIMEOUT_MS = 30_000;
const JSON_HEADERS = { "Content-Type": "application/json" };

const hasGroq = () => Boolean(process.env.GROQ_API_KEY);
const hasOpenAI = () => Boolean(process.env.OPENAI_API_KEY);
const hasAnthropic = () => Boolean(process.env.ANTHROPIC_API_KEY);
const hasOllama = () => Boolean(process.env.OLLAMA_HOST || process.env.NODE_ENV !== "production");

const canUseAI = () => hasGroq() || hasOpenAI() || hasAnthropic() || hasOllama();

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

const buildPrompt = (document: GeneratedDocument, locale: LocaleMessages, language: LanguageCode) => {
  const narrativePrompt = locale.docs.text.aiNarrativePrompt;
  const bestPracticesPrompt = locale.docs.text.aiBestPracticesPrompt;
  const testCasesPrompt = locale.docs.text.aiTestCasesPrompt;

  return [
    `Language: ${language}`,
    `Document template: ${document.templateId ?? document.name}`,
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

const callGroq = async (prompt: string): Promise<AIResponse> => {
  const model = process.env.GROQ_MODEL || "mixtral-8x7b-32768";
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

  if (!response.ok) {
    throw new Error(`Groq request failed: ${response.status}`);
  }

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
  const providers: Array<() => Promise<AIResponse>> = [];

  if (hasGroq()) {
    providers.push(() => callGroq(prompt));
  }
  if (hasOpenAI()) {
    providers.push(() => callOpenAI(prompt));
  }
  if (hasAnthropic()) {
    providers.push(() => callAnthropic(prompt));
  }
  if (hasOllama()) {
    providers.push(() => callOllama(prompt));
  }

  let lastError: Error | null = null;
  for (const provider of providers) {
    try {
      return await provider();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown provider error");
    }
  }

  throw lastError ?? new Error("No AI providers available");
};

const enhanceDocumentWithAI = async (
  document: GeneratedDocument,
  locale: LocaleMessages,
  language: LanguageCode,
) => {
  const prompt = buildPrompt(document, locale, language);
  const response = await callPreferredProvider(prompt);
  return {
    document: {
      ...document,
      markdown: response.text,
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
