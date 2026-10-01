import "server-only";

import { AUTO_DETECT, labelOf, toDeepLSource, toDeepLTarget } from "./languages";
import type { ServerConfig } from "./env";
import { fallbackCandidates, probeModels } from "./models";

export type TranslateParams = {
  text: string;
  target: string;
  source?: string;
};

export type TranslateResult = {
  translatedText: string;
  provider: string;
  model: string;
  /** 模型是自动侦测选出来的，还是调用方指定的 */
  modelSource: "auto" | "requested" | "fallback";
  detectedSource: string | null;
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
};

export class UpstreamError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_MODEL_ATTEMPTS = 3;

export async function translate(
  params: TranslateParams,
  config: ServerConfig,
  requestedModel?: string,
): Promise<TranslateResult> {
  if (config.provider === "deepl") return translateWithDeepL(params, config);

  // 1) 调用方指定 → 2) 环境变量指定 → 3) /models 自动侦测 → 4) 兜底猜测
  const candidates = await buildCandidates(config, requestedModel);
  const explicit = Boolean(requestedModel || config.model);

  let lastError: unknown = null;
  for (let i = 0; i < candidates.length && i < MAX_MODEL_ATTEMPTS; i += 1) {
    const model = candidates[i]!;
    try {
      const result = await translateWithOpenAI(params, config, model);
      return {
        ...result,
        modelSource: explicit && i === 0 ? "requested" : i === 0 ? "auto" : "fallback",
      };
    } catch (error) {
      lastError = error;
      // 仅当「模型不可用」时换下一个候选重试，鉴权/限流等错误直接抛出
      if (!isModelUnavailable(error)) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new UpstreamError("没有可用的模型，请检查 Base URL 与 API Key", 502);
}

async function buildCandidates(config: ServerConfig, requestedModel?: string): Promise<string[]> {
  const list: string[] = [];
  const push = (value?: string | null) => {
    const id = value?.trim();
    if (id && !list.includes(id)) list.push(id);
  };

  push(requestedModel);
  push(config.model);

  const probe = await probeModels(config);
  for (const id of probe.models.slice(0, 5)) push(id);
  for (const id of fallbackCandidates(config.baseUrl)) push(id);

  return list;
}

function isModelUnavailable(error: unknown): boolean {
  if (!(error instanceof UpstreamError)) return false;
  if (error.status === 404) return true;
  if (error.status === 400) {
    return /model|deploy|not (found|exist)|unknown|unsupport|invalid/i.test(error.message);
  }
  return false;
}

/* ---------------------------------- OpenAI 兼容端点 --------------------------------- */

const SYSTEM_PROMPT = `You are a professional translation engine.
Rules:
1. Translate the user's text into the requested target language.
2. Reply with ONE JSON object only: {"translation": "<the translated text>"}
3. Preserve line breaks, Markdown, emoji, code blocks and placeholders such as {name}, %s, <tag>, {{var}}.
4. Never add explanations, notes, alternatives or surrounding quotes.
5. Keep the original tone, register and formatting. If the text is already in the target language, return it unchanged.`;

async function translateWithOpenAI(
  { text, target, source }: TranslateParams,
  config: ServerConfig,
  model: string,
): Promise<Omit<TranslateResult, "modelSource">> {
  const userPrompt = [
    `Target language: ${labelOf(target)} (${target})`,
    `Source language: ${source && source !== AUTO_DETECT ? labelOf(source) : "auto-detect"}`,
    "",
    "Text to translate:",
    '"""',
    text,
    '"""',
  ].join("\n");

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await safeErrorBody(response);
    throw new UpstreamError(
      `翻译服务调用失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`,
      response.status === 401 || response.status === 403 ? 401 : response.status,
    );
  }

  const data = (await response.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const raw = data.choices?.[0]?.message?.content ?? "";
  if (!raw.trim()) {
    throw new UpstreamError("翻译服务返回了空结果", 502);
  }

  return {
    translatedText: extractTranslation(raw),
    provider: "openai-compatible",
    model: data.model ?? model,
    detectedSource: source && source !== AUTO_DETECT ? source : null,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : null,
  };
}

/** 模型可能返回 JSON、带 ```json 代码块的 JSON，或干脆直接返回纯译文，这里统一兜底 */
function extractTranslation(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  const fromJson = tryParseJsonTranslation(cleaned);
  if (fromJson !== null) return fromJson;

  const match = cleaned.match(/\{[\s\S]*?"translation"\s*:\s*[\s\S]*?\}/);
  if (match) {
    const nested = tryParseJsonTranslation(match[0]);
    if (nested !== null) return nested;
  }

  return cleaned;
}

function tryParseJsonTranslation(input: string): string | null {
  try {
    const parsed: unknown = JSON.parse(input);
    if (typeof parsed === "string") return parsed.trim();
    if (parsed && typeof parsed === "object" && "translation" in parsed) {
      const value = (parsed as Record<string, unknown>).translation;
      if (typeof value === "string") return value.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/* -------------------------------------- DeepL -------------------------------------- */

async function translateWithDeepL(
  { text, target, source }: TranslateParams,
  config: ServerConfig,
): Promise<TranslateResult> {
  const body: Record<string, unknown> = {
    text: [text],
    target_lang: toDeepLTarget(target),
  };
  const sourceLang = toDeepLSource(source);
  if (sourceLang) body.source_lang = sourceLang;

  const response = await fetch(`${config.baseUrl}/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `DeepL-Auth-Key ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await safeErrorBody(response);
    throw new UpstreamError(
      `DeepL 调用失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`,
      response.status === 403 || response.status === 456 ? 401 : 502,
    );
  }

  const data = (await response.json()) as {
    translations?: Array<{ text?: string; detected_source_language?: string }>;
  };

  const first = data.translations?.[0];
  if (!first?.text) {
    throw new UpstreamError("DeepL 返回了空结果", 502);
  }

  return {
    translatedText: first.text,
    provider: "deepl",
    model: "DeepL",
    modelSource: "auto",
    detectedSource: first.detected_source_language?.toLowerCase() ?? null,
    usage: null,
  };
}

/** 读取上游错误体用于判因，回传时已截断且不含请求头信息 */
async function safeErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300);
  } catch {
    return "";
  }
}
