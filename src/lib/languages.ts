export type Language = {
  /** 对外统一使用的语言代码（DeepL 分支内部会再做一次映射） */
  code: string;
  label: string;
};

export const LANGUAGES: readonly Language[] = [
  { code: "zh", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "it", label: "Italiano" },
  { code: "ar", label: "العربية" },
  { code: "th", label: "ไทย" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "hi", label: "हिन्दी" },
] as const;

export const AUTO_DETECT = "auto";

export const SOURCE_LANGUAGES: readonly Language[] = [
  { code: AUTO_DETECT, label: "自动检测" },
  ...LANGUAGES,
];

const TARGET_CODES = new Set(LANGUAGES.map((item) => item.code));
const SOURCE_CODES = new Set(SOURCE_LANGUAGES.map((item) => item.code));

export function isSupportedTarget(code: unknown): code is string {
  return typeof code === "string" && TARGET_CODES.has(code);
}

export function isSupportedSource(code: unknown): code is string {
  return typeof code === "string" && SOURCE_CODES.has(code);
}

export function labelOf(code: string): string {
  return LANGUAGES.find((item) => item.code === code)?.label ?? code;
}

/** DeepL 的语言代码体系略有不同，这里做一次映射 */
const DEEPL_TARGET_MAP: Record<string, string> = {
  zh: "ZH-HANS",
  "zh-TW": "ZH-HANT",
  en: "EN-US",
  ja: "JA",
  ko: "KO",
  fr: "FR",
  de: "DE",
  es: "ES",
  pt: "PT-BR",
  ru: "RU",
  it: "IT",
  ar: "AR",
  th: "TH",
  vi: "VI",
  id: "ID",
  hi: "HI",
};

export function toDeepLTarget(code: string): string {
  return DEEPL_TARGET_MAP[code] ?? code.toUpperCase();
}

export function toDeepLSource(code: string | undefined): string | undefined {
  if (!code || code === AUTO_DETECT) return undefined;
  return toDeepLTarget(code).split("-")[0];
}
