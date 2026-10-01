"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Logo } from "@/components/Logo";
import { LANGUAGES, SOURCE_LANGUAGES, labelOf } from "@/lib/languages";

/** 与服务端 MAX_TEXT_LENGTH 保持一致 */
const MAX_CHARS = 4000;
const HISTORY_KEY = "translator.history";
const THEME_KEY = "theme";
const AUTO_DEBOUNCE_MS = 700;

type TranslateResponse = {
  translatedText: string;
  target: string;
  source: string;
  provider: string;
  model: string;
  modelSource?: "auto" | "requested" | "fallback";
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
};

type ModelsResponse = {
  host: string;
  provider: string;
  detected: boolean;
  models: string[];
  recommended: string | null;
  pinned: string | null;
};

type HistoryItem = {
  src: string;
  dst: string;
  source: string;
  target: string;
  ts: number;
};

export default function Home() {
  const [text, setText] = useState("");
  const [source, setSource] = useState("auto");
  const [target, setTarget] = useState("zh");
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [auto, setAuto] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [copied, setCopied] = useState(false);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");

  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------------------ 模型侦测 ------------------------------ */

  const loadModels = useCallback(async (refresh = false) => {
    setModelsLoading(true);
    try {
      const response = await fetch(`/api/models${refresh ? "?refresh=1" : ""}`);
      const data = (await response.json()) as ModelsResponse & { error?: string };
      if (response.ok) setModels(data);
    } catch {
      /* 侦测失败不阻塞翻译，后端会退回通用候选 */
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  /* ------------------------------ 主题 ------------------------------ */

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* 隐私模式下忽略 */
      }
      return next;
    });
  }, []);

  /* ------------------------------ 历史 ------------------------------ */

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw) as HistoryItem[]);
    } catch {
      /* 忽略损坏数据 */
    }
  }, []);

  const pushHistory = useCallback((item: HistoryItem) => {
    setHistory((prev) => {
      const next = [item, ...prev.filter((row) => row.src !== item.src)].slice(0, 8);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* 忽略写入失败 */
      }
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* noop */
    }
  }, []);

  /* ------------------------------ 翻译 ------------------------------ */

  const run = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setCopied(false);
    const started = performance.now();

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          target,
          source,
          model: selectedModel || undefined,
        }),
      });
      const data = (await response.json()) as Partial<TranslateResponse> & { error?: string };
      if (id !== requestId.current) return;

      if (!response.ok) {
        setError(data.error ?? `请求失败（HTTP ${response.status}）`);
        return;
      }

      const payload = data as TranslateResponse;
      setResult(payload);
      setElapsed(Math.round(performance.now() - started));
      pushHistory({
        src: trimmed,
        dst: payload.translatedText,
        source: payload.source,
        target: payload.target,
        ts: Date.now(),
      });
    } catch {
      if (id === requestId.current) setError("网络异常，请检查服务是否已启动");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [text, target, source, selectedModel, pushHistory]);

  /** 自动翻译：输入停止 700ms 后触发 */
  useEffect(() => {
    if (!auto) return;
    if (!text.trim()) {
      setResult(null);
      setElapsed(null);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), AUTO_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [auto, text, run]);

  const swap = useCallback(() => {
    if (source === "auto") return;
    setSource(target);
    setTarget(source);
    setResult(null);
    setElapsed(null);
  }, [source, target]);

  const copy = useCallback(async () => {
    if (!result?.translatedText) return;
    try {
      await navigator.clipboard.writeText(result.translatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("复制失败，请手动选择文本");
    }
  }, [result]);

  const detected = useMemo(() => {
    if (!result) return null;
    const from = labelOf(result.source);
    const to = labelOf(result.target);
    return `${from} → ${to}`;
  }, [result]);

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div className="brand-text">
            <h1>Translator</h1>
            <p>Global Communication, Simplified &amp; Connected.</p>
          </div>
        </div>

        <div className="topbar-actions">
          <label className="switch">
            <input
              type="checkbox"
              checked={auto}
              onChange={(event) => setAuto(event.target.checked)}
            />
            <span className="switch-track" />
            <span>自动翻译</span>
          </label>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            title={theme === "dark" ? "切换到浅色" : "切换到深色"}
            aria-label="切换主题"
          >
            {theme === "dark" ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <div className="modelbar">
        <span className="modelbar-label">模型</span>
        <select
          className="mini-select"
          value={selectedModel}
          onChange={(event) => setSelectedModel(event.target.value)}
          disabled={models?.models.length === 0}
          aria-label="选择翻译模型"
        >
          <option value="">
            {models?.recommended ? `自动（${models.recommended}）` : "自动侦测"}
          </option>
          {(models?.models ?? []).map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <span className="modelbar-meta">
          {modelsLoading
            ? "侦测中…"
            : models?.detected
              ? `已从 ${models.host} 侦测到 ${models.models.length} 个可用模型`
              : "未能侦测到模型列表，将按接口地址自动试选"}
        </span>
        <button type="button" className="mini-btn" onClick={() => void loadModels(true)}>
          重新侦测
        </button>
      </div>

      <section className="workbench">
        <div className="panel">
          <div className="panel-head">
            <select
              className="lang-select"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              aria-label="源语言"
            >
              {SOURCE_LANGUAGES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
            <div className="panel-tools">
              <button
                type="button"
                className="mini-btn"
                onClick={() => {
                  setText("");
                  setResult(null);
                  setElapsed(null);
                }}
                disabled={!text}
              >
                清空
              </button>
            </div>
          </div>
          <div className="panel-body">
            <textarea
              value={text}
              maxLength={MAX_CHARS}
              spellCheck={false}
              placeholder="输入要翻译的内容"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void run();
                }
              }}
            />
            <div className="panel-foot">
              <span>
                {text.length}/{MAX_CHARS}
              </span>
            </div>
          </div>
        </div>

        <div className="middle">
          <button
            type="button"
            className="translate-btn"
            onClick={() => void run()}
            disabled={loading || !text.trim()}
          >
            {loading ? "翻译中…" : "翻译"}
          </button>
          <button type="button" className="swap-btn" onClick={swap} disabled={source === "auto"}>
            ⇄ 交换
          </button>
          <div className="kbd-hint">⌘/Ctrl + Enter</div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <select
              className="lang-select"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              aria-label="目标语言"
            >
              {LANGUAGES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
            <div className="panel-tools">
              <button
                type="button"
                className="mini-btn"
                onClick={() => void copy()}
                disabled={!result?.translatedText}
              >
                {copied ? "已复制" : "复制"}
              </button>
            </div>
          </div>
          <div className="panel-body">
            <textarea value={result?.translatedText ?? ""} readOnly placeholder="译文" />
            <div className="panel-foot">
              {detected ? (
                <span className="detected">
                  {detected}
                  <span className="dot" />
                  {elapsed !== null ? `${elapsed}ms` : "—"}
                  {result?.model ? (
                    <>
                      <span className="dot" />
                      {result.model}
                      {result.modelSource === "fallback" ? "（已自动降级）" : ""}
                      {result.modelSource === "auto" ? "（自动侦测）" : ""}
                    </>
                  ) : null}
                </span>
              ) : (
                <span>{result ? "" : "等待输入"}</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {error ? <div className="error">{error}</div> : null}

      <section className="section">
        <div className="section-head">
          <h2>最近翻译</h2>
          {history.length > 0 ? (
            <button type="button" className="mini-btn" onClick={clearHistory}>
              清除
            </button>
          ) : null}
        </div>
        {history.length === 0 ? (
          <div className="empty">还没有记录，翻译一次后会出现在这里</div>
        ) : (
          <div className="history">
            {history.map((item) => (
              <button
                type="button"
                className="history-item"
                key={`${item.ts}-${item.src.slice(0, 8)}`}
                onClick={() => {
                  setText(item.src);
                  setTarget(item.target);
                  setResult({
                    translatedText: item.dst,
                    target: item.target,
                    source: item.source,
                    provider: "",
                    model: "",
                    usage: null,
                  });
                  setElapsed(null);
                }}
              >
                <span className="history-src">{item.src}</span>
                <span className="history-dst">{item.dst}</span>
                <span className="history-meta">
                  {labelOf(item.source)} → {labelOf(item.target)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <p className="footnote">
        只需配置 API Base URL 与 API Key，模型由服务端调用 /models 自动侦测并按翻译场景打分选优；
        密钥只保存在服务端，浏览器只访问本站的 /api/translate 与 /api/models。
      </p>
    </main>
  );
}
