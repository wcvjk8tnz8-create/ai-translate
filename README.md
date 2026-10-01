# Next.js 翻译服务（只需 API Base URL + API Key）

Next.js 16（App Router） + TypeScript 打造的翻译服务，自带 Web 界面与 HTTP API。
配置只需两项：接口地址与密钥；模型由服务端自动侦测并择优，服务商类型自动识别。

## 快速开始

```bash
cp .env.example .env.local     # 填 TRANSLATE_BASE_URL 和 TRANSLATE_API_KEY
npm install
npm run dev                    # http://localhost:3000
```

生产模式：`npm run build && npm start`

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `TRANSLATE_BASE_URL` | ✅ | - | 接口地址，填到 `/v1` 即可，不带 `/chat/completions`；缺协议会自动补 `https://` |
| `TRANSLATE_API_KEY` | ✅ | - | API Key |
| `TRANSLATE_MODEL` | 否 | 自动侦测 | 手动锁定模型，填了就不做侦测 |
| `RATE_LIMIT_PER_MINUTE` | 否 | `30` | 单 IP 每分钟请求上限 |
| `MAX_TEXT_LENGTH` | 否 | `4000` | 单次请求文本最大字符数 |

DeepL 只需把地址换成 `https://api-free.deepl.com/v2`（专业版为 `https://api.deepl.com/v2`），
程序会自动识别并改走 DeepL 协议，Key 仍填在 `TRANSLATE_API_KEY`。

## 模型自动侦测

启动后调用 `GET {TRANSLATE_BASE_URL}/models` 拉取可用模型，结果缓存 10 分钟（失败缓存 1 分钟）。

1. **过滤**：剔除 embedding / tts / whisper / dalle / image / moderation / rerank / 量化版等非对话模型
2. **打分**：按家族给基础分（gpt-5-mini、gpt-4o-mini、claude-haiku、gemini-flash、deepseek-chat、qwen-plus、glm-4-flash 等优先），
   mini / flash / lite / turbo / haiku 等轻量款 +12，推理模型（r1、o1、thinking）-24，
   超大参数（70B/405B/671B）-16，量化与老型号再扣分
3. **降级**：若首选模型返回 400/404 或 "model not found"，自动换下一个候选重试，最多 3 次
4. **兜底**：`/models` 探测不到时，按接口域名猜一批候选（deepseek → deepseek-chat、dashscope → qwen-plus、openrouter → openai/gpt-4o-mini …），再接通用候选

界面上可手动切换模型，默认「自动（侦测到的最优模型）」，点「重新侦测」可强制刷新。

## HTTP API

### `POST /api/translate`

```json
{ "text": "Hello, world!", "target": "zh", "source": "auto", "model": "可选，留空自动侦测" }
```

成功响应：

```json
{
  "translatedText": "你好，世界！",
  "target": "zh",
  "source": "en",
  "provider": "openai-compatible",
  "model": "gpt-4o-mini",
  "modelSource": "auto",
  "usage": { "promptTokens": 68, "completionTokens": 9, "totalTokens": 77 }
}
```

`modelSource`：`auto` 自动侦测 / `requested` 调用方指定 / `fallback` 首选模型不可用已自动降级。

```bash
curl -X POST http://localhost:3000/api/translate \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello, world!","target":"zh"}'
```

错误响应统一为 `{ "error": "..." }`，常见状态码：

| HTTP | 含义 |
| --- | --- |
| 400 | 参数问题：JSON 非法、缺文本、文本过长、语言不支持 |
| 401 | API Key 无效或额度不足 |
| 429 | 触发限流（默认 30 次/分钟/IP，响应带 `Retry-After`） |
| 500 | 服务端未配置接口地址 / Key |
| 502 | 上游服务出错或超时（30s） |

### `GET /api/models`

返回侦测到的模型列表与推荐模型，不含任何密钥信息：

```json
{ "host": "api.openai.com", "provider": "openai-compatible", "detected": true,
  "models": ["gpt-4o-mini", "..."], "recommended": "gpt-4o-mini", "pinned": null }
```

加 `?refresh=1` 可强制重新侦测（限 20 次/分钟/IP）。

### `GET /api/translate`

返回支持的语言列表。

## 支持的语言

`auto`（仅源语言）、`zh`、`zh-TW`、`en`、`ja`、`ko`、`fr`、`de`、`es`、`pt`、`ru`、`it`、`ar`、`th`、`vi`、`id`、`hi`。

## 界面

双栏并排（左原文 / 右译文），含语言选择、字数统计 `x/4000`、交换、复制、`⌘/Ctrl + Enter` 翻译、
自动翻译开关（停手 700ms 后自动请求）、模型下拉与重新侦测、最近翻译 8 条（localStorage）、
亮/暗主题切换（默认亮色）。配色为中性灰白 + 蓝橙点缀，无渐变背景。

## 目录结构

```
src/
  app/
    api/translate/route.ts   # POST 翻译 / GET 语言列表
    api/models/route.ts      # GET 模型侦测结果
    layout.tsx  page.tsx  globals.css
  components/Logo.tsx        # 内联 SVG 双气泡 logo
  lib/
    env.ts        # 只读取 Base URL + Key，推断服务商（server-only）
    models.ts     # /models 侦测、过滤、打分、兜底候选
    languages.ts  # 语言白名单与 DeepL 代码映射
    rate-limit.ts # 固定窗口内存限流
    translate.ts  # 上游调用与模型失败降级重试
```

## 安全与部署

- 密钥只在服务端使用：`src/lib/env.ts` 顶部 `import "server-only"`，一旦被客户端组件误引用会直接构建失败。
- `.env*` 全部加入 `.gitignore`，不要把 Key 提交到仓库，也不要放进 `NEXT_PUBLIC_` 变量。
- 默认限流是进程内内存实现，仅适用于单实例；多实例部署请换成 Redis 等共享存储。
- **Vercel**：导仓库后在 Settings → Environment Variables 填两个变量即可；免费版函数 10s 超时，长翻译可能被截断，建议把 `REQUEST_TIMEOUT_MS` 调到 9s 左右。国内访问默认域名可能不稳，建议绑自有域名或部署到国内云。
- **自有服务器 / Docker**：`npm run build && npm start`，Nginx 反代 + HTTPS，环境变量写进进程环境而非镜像。
- 部署后先打一次 `GET /api/models` 自检：能返回模型列表即说明地址与 Key 都通了。
