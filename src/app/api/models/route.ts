import { NextResponse } from "next/server";

import { ConfigError, hostOf, readServerConfig } from "@/lib/env";
import { probeModels } from "@/lib/models";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/models —— 从 Base URL 的 /models 端点侦测可用模型并给出推荐 */
export async function GET(request: Request) {
  let config;
  try {
    config = readServerConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      return NextResponse.json({ error: "服务端未配置 TRANSLATE_BASE_URL / TRANSLATE_API_KEY" }, { status: 500 });
    }
    throw error;
  }

  const limit = rateLimit(`models:${clientKey(request)}`, 20);
  if (!limit.ok) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const probe = await probeModels(config, force);

  return NextResponse.json({
    host: hostOf(config.baseUrl),
    provider: config.provider,
    detected: probe.detected,
    models: probe.models.slice(0, 40),
    recommended: probe.recommended,
    pinned: config.model,
  });
}
