import "server-only";

import type { ServerConfig } from "./env";

/**
 * 模型自动侦测：
 * 1. 调 GET {baseUrl}/models 拿可用列表（结果缓存 10 分钟）
 * 2. 过滤掉非对话模型（嵌入 / 语音 / 图像 / 审核 / rerank …）
 * 3. 按「翻译质量 × 响应速度 × 成本」打分排序，取最高分作为默认模型
 * 4. 侦测失败时不阻塞翻译，改用按 Base URL 猜测的候选清单逐个试
 */

export type ModelProbe = {
  models: string[];
  recommended: string | null;
  detected: boolean;
};

const CACHE_TTL_MS = 10 * 60_000;
const FAILURE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;

type CacheEntry = { at: number; models: string[]; ok: boolean };

const cache = new Map<string, CacheEntry>();

const EXCLUDE =
  /(embed|embedding|tts|whisper|transcri|dall-?e|image|vision|moderation|rerank|re-?rank|audio|speech|sora|babbage|davinci|curie|ada-?|text-?search|similarity|guard|safety|ocr|asr|bge|gte|jina|clip|sd-?xl|flux|video)/i;

/** 家族基础分：越高越适合做翻译（同族内越大越好，同时兼顾价格） */
const FAMILY: Array<[RegExp, number]> = [
  [/gpt-5[\.-]?mini/i, 34],
  [/gpt-5/i, 30],
  [/gpt-4o[\.-]?mini/i, 34],
  [/gpt-4o/i, 27],
  [/gpt-4[\.-]?1[\.-]?mini/i, 33],
  [/gpt-4[\.-]?1[\.-]?nano/i, 29],
  [/gpt-4[\.-]?1/i, 27],
  [/claude[\.-].*haiku/i, 30],
  [/claude[\.-].*sonnet/i, 26],
  [/claude[\.-].*opus/i, 19],
  [/claude/i, 20],
  [/gemini[\.-].*flash/i, 30],
  [/gemini[\.-].*pro/i, 21],
  [/deepseek[\.-]?(v3|chat)/i, 32],
  [/deepseek[\.-]?r1/i, 6],
  [/deepseek/i, 22],
  [/glm[\.-]?4[\.-]?(flash|air)/i, 30],
  [/glm/i, 20],
  [/qwen.*(plus|flash|turbo)/i, 28],
  [/qwen.*max/i, 22],
  [/qwen/i, 17],
  [/hunyuan.*(turbo|lite|flash|standard)/i, 27],
  [/hunyuan/i, 17],
  [/kimi|moonshot/i, 21],
  [/doubao.*(lite|pro|flash)/i, 26],
  [/doubao/i, 18],
  [/grok/i, 18],
  [/mistral|mixtral/i, 15],
  [/llama[\.-]?3/i, 13],
  [/command[\.-]?r/i, 12],
];

export function scoreModel(id: string): number {
  const n = id.toLowerCase();
  let score = 40;

  for (const [pattern, bonus] of FAMILY) {
    if (pattern.test(n)) {
      score += bonus;
      break;
    }
  }

  // 小而快 → 翻译这种短任务性价比最高
  if (/(mini|flash|lite|turbo|nano|tiny|haiku|small|air)/i.test(n)) score += 12;

  // 推理模型：翻译场景慢且容易夹带思考过程
  if (/(reason|thinking|r1[\.-]|-r1|o1[\.-]|o3[\.-]|o4[\.-]|qwq)/i.test(n)) score -= 24;

  // 超大参数：慢
  if (/(405b|671b|235b|123b|122b|104b|72b|70b)/i.test(n)) score -= 16;

  // 量化 / 蒸馏版本：质量与稳定性一般
  if (/(int4|int8|fp8|fp4|awq|gptq|gguf|quant|distill)/i.test(n)) score -= 12;

  // 老模型
  if (/(gpt-?3\.5|claude-?2|claude-?3-(haiku|opus|sonnet)(-\d{6})?$|gpt-?4-(0613|0314|32k))/i.test(n)) score -= 10;

  // base / instruct 原始权重，指令跟随差
  if (/(-base$|[/-]base|instruct$)/i.test(n)) score -= 8;

  // 免费档位通常限流更狠
  if (/[:@-]?free$/i.test(n)) score -= 4;

  // 带日期戳的更新快照，略优先
  if (/(20\d{6}|20\d{2}-\d{2}-\d{2})/.test(n)) score += 3;

  // 同名不同大小写/重复项保持稳定排序
  return Math.round(score * 100) / 100;
}

export function isChatModel(id: string): boolean {
  return !EXCLUDE.test(id);
}

/** 从各种网关的返回体里尽量抠出模型 id 列表 */
function extractIds(payload: unknown): string[] {
  const ids = new Set<string>();

  const walk = (value: unknown, depth: number): void => {
    if (depth > 5 || value === null || value === undefined) return;
    if (typeof value === "string") {
      if (value.trim()) ids.add(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.id === "string" && record.id.trim()) ids.add(record.id.trim());
      for (const key of ["data", "models", "model", "results", "items"]) {
        if (key in record) walk(record[key], depth + 1);
      }
    }
  };

  walk(payload, 0);
  return [...ids];
}

export function rankModels(ids: string[]): string[] {
  return ids
    .filter((id) => isChatModel(id))
    .slice()
    .sort((a, b) => scoreModel(b) - scoreModel(a) || a.localeCompare(b));
}

export async function probeModels(config: ServerConfig, force = false): Promise<ModelProbe> {
  if (config.provider === "deepl") {
    return { models: [], recommended: null, detected: false };
  }

  const key = config.baseUrl;
  const cached = cache.get(key);
  if (!force && cached && Date.now() - cached.at < (cached.ok ? CACHE_TTL_MS : FAILURE_TTL_MS)) {
    return {
      models: cached.models,
      recommended: cached.models[0] ?? null,
      detected: cached.ok,
    };
  }

  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      cache.set(key, { at: Date.now(), models: [], ok: false });
      return { models: [], recommended: null, detected: false };
    }

    const models = rankModels(extractIds(await response.json()));
    cache.set(key, { at: Date.now(), models, ok: true });
    return { models, recommended: models[0] ?? null, detected: true };
  } catch {
    cache.set(key, { at: Date.now(), models: [], ok: false });
    return { models: [], recommended: null, detected: false };
  }
}

/** 侦测失败时的兜底清单：按 Base URL 猜一批，再接常见通用名 */
export function fallbackCandidates(baseUrl: string): string[] {
  const host = baseUrl.toLowerCase();
  const guesses: string[] = [];

  if (/api\.openai\.com/.test(host)) guesses.push("gpt-4o-mini", "gpt-4.1-mini", "gpt-4o");
  else if (/agnes/.test(host)) guesses.push("agnes-gpt-4o-mini", "gpt-4o-mini");
  else if (/deepseek/.test(host)) guesses.push("deepseek-chat", "deepseek-v3");
  else if (/dashscope|aliyun|qwen/.test(host)) guesses.push("qwen-plus", "qwen-turbo");
  else if (/moonshot|kimi/.test(host)) guesses.push("moonshot-v1-8k", "kimi-k2");
  else if (/volces|ark|doubao/.test(host)) guesses.push("doubao-pro-32k", "doubao-lite-32k");
  else if (/bigmodel|glm|zhipu/.test(host)) guesses.push("glm-4-flash", "glm-4-plus");
  else if (/openrouter/.test(host)) guesses.push("openai/gpt-4o-mini", "google/gemini-2.0-flash-001");
  else if (/siliconflow|silicon/.test(host)) guesses.push("Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V3");
  else if (/groq/.test(host)) guesses.push("llama-3.3-70b-versatile", "llama-3.1-8b-instant");
  else if (/hunyuan|tencent/.test(host)) guesses.push("hunyuan-turbo", "hunyuan-lite");
  else if (/x\.ai|xai/.test(host)) guesses.push("grok-3-mini", "grok-3");
  else if (/anthropic/.test(host)) guesses.push("claude-3-5-haiku-latest", "claude-3-5-sonnet-latest");
  else if (/localhost|127\.0\.0\.1|ollama/.test(host)) guesses.push("qwen2.5:7b", "llama3.1:8b");

  for (const generic of ["gpt-4o-mini", "gpt-4.1-mini", "deepseek-chat", "qwen-plus", "glm-4-flash"]) {
    if (!guesses.includes(generic)) guesses.push(generic);
  }
  return guesses;
}
