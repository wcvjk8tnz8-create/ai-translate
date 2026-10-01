import { NextResponse } from "next/server";

import { ConfigError, hostOf, readServerConfig } from "@/lib/env";
import { isSupportedSource, isSupportedTarget, LANGUAGES } from "@/lib/languages";
import { probeModels } from "@/lib/models";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { translate, UpstreamError } from "@/lib/translate";

// 必须跑在 Node 运行时：密钥只在服务端内存中读取，不进入任何客户端产物
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error: message }, { status, headers });
}

export async function POST(request: Request) {
  // 1. 读取并校验服务端配置（缺 Key 直接 500，不把细节暴露给客户端）
  let config;
  try {
    config = readServerConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("[translate] 配置错误:", error.message);
      return fail("服务端未配置 TRANSLATE_BASE_URL / TRANSLATE_API_KEY", error.status);
    }
    throw error;
  }

  // 2. 限流，避免 Key 被盗刷
  const limit = rateLimit(`translate:${clientKey(request)}`, config.rateLimitPerMinute);
  const rateHeaders: HeadersInit = {
    "X-RateLimit-Limit": String(limit.limit),
    "X-RateLimit-Remaining": String(limit.remaining),
    "X-RateLimit-Reset": String(Math.ceil(limit.resetAt / 1000)),
  };
  if (!limit.ok) {
    return fail("请求过于频繁，请稍后再试", 429, {
      ...rateHeaders,
      "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
    });
  }

  // 3. 解析并校验请求体
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail("请求体不是合法 JSON", 400, rateHeaders);
  }

  const body = payload as { text?: unknown; target?: unknown; source?: unknown; model?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const target = typeof body.target === "string" ? body.target : "";
  const source = typeof body.source === "string" && body.source ? body.source : "auto";
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;

  if (!text) return fail("缺少待翻译文本 text", 400, rateHeaders);
  if (text.length > config.maxTextLength) {
    return fail(`文本过长，单次最多 ${config.maxTextLength} 个字符`, 413, rateHeaders);
  }
  if (!isSupportedTarget(target)) return fail(`不支持的目标语言：${target || "(空)"}`, 400, rateHeaders);
  if (!isSupportedSource(source)) return fail(`不支持的源语言：${source}`, 400, rateHeaders);

  // 4. 调用上游翻译服务（模型未指定时自动侦测）
  try {
    const result = await translate({ text, target, source }, config, model);
    return NextResponse.json(
      {
        translatedText: result.translatedText,
        target,
        source: result.detectedSource ?? source,
        provider: result.provider,
        model: result.model,
        modelSource: result.modelSource,
        usage: result.usage,
      },
      { status: 200, headers: rateHeaders },
    );
  } catch (error) {
    if (error instanceof UpstreamError) {
      console.error("[translate] 上游错误:", error.message);
      return fail(error.message, error.status >= 400 ? error.status : 502, rateHeaders);
    }
    const message =
      error instanceof Error && error.name === "TimeoutError" ? "翻译服务响应超时" : "翻译服务内部错误";
    console.error("[translate] 未预期错误:", error);
    return fail(message, 500, rateHeaders);
  }
}

/** GET：返回支持的语言列表（模型列表请调 /api/models） */
export async function GET() {
  return NextResponse.json({
    endpoint: "POST /api/translate",
    body: {
      text: "string",
      target: "string",
      source: "string(可选, 默认 auto)",
      model: "string(可选, 默认自动侦测)",
    },
    languages: LANGUAGES,
  });
}
