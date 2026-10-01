import "server-only";

export type Provider = "openai-compatible" | "deepl";

export type ServerConfig = {
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  /** 可选：手动指定模型；留空则由 /models 自动侦测选择 */
  model: string | null;
  rateLimitPerMinute: number;
  maxTextLength: number;
};

export class ConfigError extends Error {
  readonly status = 500;
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** 自动补全协议、去掉尾斜杠，允许只填域名；误填成 /chat/completions 也会帮你截掉 */
function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/chat\/completions$/i, "").replace(/\/+$/, "");
  return url;
}

/** 按 Base URL 推断服务商，只区分 DeepL 与 OpenAI 兼容端点 */
export function detectProvider(baseUrl: string): Provider {
  return /deepl\.com/i.test(baseUrl) ? "deepl" : "openai-compatible";
}

export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function readServerConfig(): ServerConfig {
  const apiKey = (process.env.TRANSLATE_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new ConfigError("缺少 TRANSLATE_API_KEY，请在环境变量中配置 API Key");
  }

  const rawBaseUrl = (process.env.TRANSLATE_BASE_URL ?? "").trim();
  if (!rawBaseUrl) {
    throw new ConfigError("缺少 TRANSLATE_BASE_URL，请在环境变量中配置接口地址");
  }
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  const model = (process.env.TRANSLATE_MODEL ?? "").trim();

  return {
    provider: detectProvider(baseUrl),
    apiKey,
    baseUrl,
    model: model || null,
    rateLimitPerMinute: positiveInt(process.env.RATE_LIMIT_PER_MINUTE, 30),
    maxTextLength: positiveInt(process.env.MAX_TEXT_LENGTH, 4000),
  };
}
