/**
 * 代码块渲染（@mdeditor/md-editor 内部）
 * - CodeBlockToolbarWidget：围栏首行的工具栏（折叠 / 语言切换 / 复制）
 * - codeFoldService：FencedCode 折叠支持（配合 @codemirror/language 的 codeFolding）
 * - findFenceAt：根据位置定位围栏（语言范围 / 代码内容范围 / 折叠范围）
 */
import { EditorView, WidgetType } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { foldEffect, foldService, foldState, syntaxTree, unfoldEffect } from "@codemirror/language";
import { climbTo, FENCE_OPEN_RE, nodeEndLine } from "./tree";
import { copyToClipboard } from "./clipboard";
import { openPopup } from "./popup";

/** 常见代码语言（点击语言 chip 弹出选择） */
const LANGUAGES = [
  "plaintext",
  "js",
  "ts",
  "jsx",
  "tsx",
  "python",
  "c",
  "cpp",
  "java",
  "rust",
  "go",
  "json",
  "html",
  "css",
  "scss",
  "bash",
  "sql",
  "markdown",
  "yaml",
  "toml",
];

interface FenceInfo {
  /** FencedCode 节点范围 */
  from: number;
  to: number;
  /** 语言文本范围（切换语言时替换） */
  langFrom: number;
  langTo: number;
  /** 代码内容范围（复制用） */
  codeFrom: number;
  codeTo: number;
  lang: string;
}

/** 根据位置向上查找 FencedCode 节点，返回围栏各范围（点击时实时计算，避免装饰位置过期） */
function findFenceAt(view: EditorView, pos: number): FenceInfo | null {
  const tree = syntaxTree(view.state);
  const doc = view.state.doc;
  const node = climbTo(tree, pos, "FencedCode");
  if (!node) return null;
  const from = node.from;
  const to = node.to;
  const startLine = doc.lineAt(from);
  const m = FENCE_OPEN_RE.exec(startLine.text);
  const markerLen = m ? m[1].length : 3;
  const lang = startLine.text.slice(markerLen).trim();
  const endLine = doc.lineAt(nodeEndLine(doc, from, to));
  const codeFrom = startLine.to + 1;
  const codeTo = endLine.text.trim().startsWith(m?.[1]?.[0] ?? "`") ? endLine.from : to;
  return {
    from,
    to,
    langFrom: startLine.from + markerLen,
    langTo: startLine.from + markerLen + lang.length,
    codeFrom,
    codeTo,
    lang,
  };
}

/** 元素中心 → 文档位置（工具栏按钮/弹层项点击时定位围栏） */
function posAtElement(view: EditorView, el: HTMLElement): number | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return view.posAtCoords({ x: r.left + r.width / 2, y: r.top + Math.min(6, r.height / 2) }, false);
}

/** 是否已折叠 */
function isFolded(view: EditorView, from: number, to: number): boolean {
  const st = view.state.field(foldState, false);
  if (!st) return false;
  let folded = false;
  st.between(from, to, () => {
    folded = true;
  });
  return folded;
}

/** 是否纯文本语言族（空 / text / plain / plaintext，用于弹层高亮 plaintext 项） */
function isPlainFamily(raw: string): boolean {
  return !raw || raw === "text" || raw === "plain" || raw === "plaintext";
}

/** 语言标签：文件里的语言原样显示（打开文件以文件中语言为准）；
 * 纯文本族（空 / text / plain / plaintext）统一显示为 plaintext */
function langLabel(raw: string): string {
  return isPlainFamily(raw) ? "plaintext" : raw;
}

/** 围栏首行工具栏：折叠 + 语言切换/输入 + 复制（替换开头的 ``` 标记） */
export class CodeBlockToolbarWidget extends WidgetType {
  constructor(private lang: string) {
    super();
  }
  eq(other: CodeBlockToolbarWidget): boolean {
    return other.lang === this.lang;
  }
  ignoreEvent(): boolean {
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "md-code-toolbar";

    // ── 折叠按钮 ──
    const foldBtn = document.createElement("button");
    foldBtn.type = "button";
    foldBtn.className = "md-code-fold";
    foldBtn.title = "折叠 / 展开代码块";
    foldBtn.textContent = "▾";
    foldBtn.onclick = (e) => {
      e.stopPropagation();
      try {
        const pos = posAtElement(view, wrap);
        const fence = pos == null ? null : findFenceAt(view, pos);
        if (!fence) return;
        const { from, to } = fence;
        if (isFolded(view, from, to)) {
          view.dispatch({ effects: unfoldEffect.of({ from, to }) });
        } else {
          view.dispatch({ effects: foldEffect.of({ from, to }) });
        }
      } catch (err) {
        console.error("[toolbar] fold error:", err);
      }
    };

    // ── 语言按钮（点击弹出选择 + 手动输入） ──
    const langBtn = document.createElement("button");
    langBtn.type = "button";
    langBtn.className = "md-code-lang";
    langBtn.title = "点击选择或输入语言";
    // 以文件中的语言表示为准；空 / text / plain 显示为 plaintext
    langBtn.textContent = langLabel(this.lang);
    langBtn.onclick = (e) => {
      e.stopPropagation();
      openLangPicker(view, langBtn, wrap, this.lang);
    };

    // ── 复制按钮 ──
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "md-code-copy";
    copyBtn.title = "复制代码";
    copyBtn.textContent = "复制";
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      const pos = posAtElement(view, wrap);
      const fence = pos == null ? null : findFenceAt(view, pos);
      if (fence) copyToClipboard(view.state.sliceDoc(fence.codeFrom, fence.codeTo));
    };

    wrap.append(foldBtn, langBtn, copyBtn);
    return wrap;
  }
}

/** 语言选择弹层（挂在 body）：顶部可手动输入任意语言（回车应用），下方预设列表一键选择 */
function openLangPicker(view: EditorView, anchor: HTMLElement, wrap: HTMLElement, rawLang: string): void {
  const { popup, close } = openPopup(anchor, "md-code-lang-picker");

  /** 应用语言：写入围栏信息串（以输入/预设的标识为准，plaintext 也写入文件） */
  const applyLang = (text: string) => {
    close();
    const pos = posAtElement(view, wrap);
    const fence = pos == null ? null : findFenceAt(view, pos);
    if (!fence) return;
    view.dispatch({
      changes: { from: fence.langFrom, to: fence.langTo, insert: text },
      userEvent: "input",
    });
  };

  // 手动输入框：以文件中的语言为准（预填原文），回车应用，Esc 关闭
  const input = document.createElement("input");
  input.type = "text";
  input.className = "md-code-lang-input";
  input.placeholder = "输入语言名（如 scss / toml）";
  input.value = rawLang;
  input.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") applyLang(input.value.trim());
    else if (ev.key === "Escape") close();
  });
  popup.appendChild(input);

  // 预设列表：点击按代码预设标识写入（见 LANGUAGES）
  for (const lang of LANGUAGES) {
    const item = document.createElement("button");
    item.type = "button";
    item.className =
      "md-code-lang-item" +
      (lang === rawLang || (lang === "plaintext" && isPlainFamily(rawLang)) ? " active" : "");
    item.textContent = lang;
    item.onclick = (e) => {
      e.stopPropagation();
      applyLang(lang);
    };
    popup.appendChild(item);
  }
  input.focus();
  input.select();
}

/** FencedCode 折叠服务：围栏起始行返回整块折叠范围 */
export function codeFoldService(): Extension {
  return foldService.of((state, lineStart) => {
    const node = climbTo(syntaxTree(state), lineStart, "FencedCode");
    if (!node || node.from !== lineStart) return null;
    const endLine = state.doc.lineAt(nodeEndLine(state.doc, node.from, node.to));
    const to = Math.min(state.doc.length, endLine.to + 1);
    return { from: lineStart, to };
  });
}
