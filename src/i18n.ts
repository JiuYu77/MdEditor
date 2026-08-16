import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";

/**
 * i18n 初始化（需求文档 §3.5.6）
 * 语言权威来源：settings.json（§3.5.3，通过 read_settings 读取后调用 applyLanguage）。
 * 初始化阶段仅跟随系统语言作为临时值，随后由设置覆盖。
 * TODO: 支持外部语言包（I-04）。
 */
function detectSystemLanguage(): string {
  const sys = navigator.language?.toLowerCase() ?? "";
  return sys.startsWith("zh") ? "zh-CN" : "en-US";
}

i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS },
  },
  lng: detectSystemLanguage(),
  fallbackLng: "en-US",
  interpolation: {
    // React 已做 XSS 转义，无需 i18next 再转义
    escapeValue: false,
  },
});

export default i18n;
