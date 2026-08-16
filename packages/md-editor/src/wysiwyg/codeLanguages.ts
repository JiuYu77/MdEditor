/**
 * 代码块语言描述（@mdeditor/md-editor 内部）
 * 使用同步 StreamLanguage（legacy-modes）+ 少量原生语言包：
 * support 预加载 → codeParser 直接取 parser，避免异步 skipping parser 的
 * 嵌套重解析在此环境不触发的问题，代码高亮即时生效。
 */
import { LanguageDescription, LanguageSupport, StreamLanguage, type Language } from "@codemirror/language";
import { c, cpp, java } from "@codemirror/legacy-modes/mode/clike";
import { javascript, typescript } from "@codemirror/legacy-modes/mode/javascript";
import { python } from "@codemirror/legacy-modes/mode/python";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { go } from "@codemirror/legacy-modes/mode/go";
import { css } from "@codemirror/legacy-modes/mode/css";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { xml } from "@codemirror/legacy-modes/mode/xml";
import { json } from "@codemirror/lang-json";
import { markdownLanguage } from "@codemirror/lang-markdown";

function ld(name: string, alias: string[], extensions: string[], lang: Language | LanguageSupport): LanguageDescription {
  const support = lang instanceof LanguageSupport ? lang : new LanguageSupport(lang);
  return LanguageDescription.of({ name, alias, extensions, support });
}

/** 围栏代码块支持的语言（同步挂载） */
export const codeLanguages: readonly LanguageDescription[] = [
  ld("C", ["c"], ["c", "h"], StreamLanguage.define(c)),
  ld("C++", ["cpp", "c++"], ["cpp", "cc", "cxx"], StreamLanguage.define(cpp)),
  ld("Java", ["java"], ["java"], StreamLanguage.define(java)),
  ld("JavaScript", ["js", "javascript", "jsx"], ["js", "mjs", "cjs", "jsx"], StreamLanguage.define(javascript)),
  ld("TypeScript", ["ts", "typescript", "tsx"], ["ts", "tsx"], StreamLanguage.define(typescript)),
  ld("Python", ["python", "py"], ["py"], StreamLanguage.define(python)),
  ld("Rust", ["rust", "rs"], ["rs"], StreamLanguage.define(rust)),
  ld("Go", ["go"], ["go"], StreamLanguage.define(go)),
  ld("CSS", ["css"], ["css"], StreamLanguage.define(css)),
  ld("SQL", ["sql"], ["sql"], StreamLanguage.define(standardSQL)),
  ld("Shell", ["shell", "sh", "bash"], ["sh", "bash"], StreamLanguage.define(shell)),
  ld("YAML", ["yaml", "yml"], ["yaml", "yml"], StreamLanguage.define(yaml)),
  ld("XML", ["xml", "html"], ["xml", "html", "htm"], StreamLanguage.define(xml)),
  ld("JSON", ["json"], ["json"], json()),
  ld("Markdown", ["markdown", "md"], ["md", "markdown"], markdownLanguage),
];
