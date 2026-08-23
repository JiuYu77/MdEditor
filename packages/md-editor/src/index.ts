/**
 * @mdeditor/md-editor —— 编辑器内核封装
 *
 * 设计约束（见需求文档 §6.1）：
 * - 对外暴露框架无关的实例 API，React 壳仅做薄封装
 * - 源码模式 / WYSIWYG 模式均基于 CodeMirror 6（WYSIWYG 采用 Live Preview：
 *   通过装饰器隐藏语法标记 + 实时样式，实现所见即所得）
 * - 自定义编辑器扩展（WYSIWYG 装饰/Widget/插件）按类别拆分在 ./wysiwyg/ 目录，
 *   对标 Obsidian src/editor_extensions 的组织方式（见文心对话归档）
 */
import { EditorState, Compartment, Prec, RangeSet, type Range, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  placeholder as cmPlaceholder,
  gutterLineClass,
  GutterMarker,
} from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, syntaxTree, codeFolding } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
  selectAll,
} from "@codemirror/commands";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { wysiwygPlugin, cursorLineSourceStateField, setCursorLineSource, codeFoldService, codeLanguages, tableToolbarPlugin } from "./wysiwyg";
import { tableCellTargetPos } from "./wysiwyg/table";
import { FENCE_CLOSE_RE, nodeEndLine } from "./wysiwyg/tree";
import { setImageUrlResolver } from "./wysiwyg/widgets";

/** 编辑模式 */
export type EditorMode = "source" | "wysiwyg";

/** 按模式的布尔开关（行号/高亮当前行：源码模式与所见即所得模式分开设置） */
export interface ModeToggles {
  source: boolean;
  wysiwyg: boolean;
}

/** 大纲条目（由语法树提取：ATX + Setext 标题，跳过代码块内的假标题） */
export interface OutlineItem {
  /** 1-6 */
  level: number;
  /** 标题文字（已去掉 # 标记） */
  text: string;
  /** 1-based 行号 */
  line: number;
  /** 标题起始位置（文档偏移，供光标跳转） */
  pos: number;
}

/** 编辑器选项 */
export interface EditorOptions {
  /** 初始内容 */
  value?: string;
  /** 初始模式，默认 "wysiwyg"（所见即所得） */
  mode?: EditorMode;
  /**
   * 是否显示行号。boolean = 两种模式统一；ModeToggles = 按模式分开。
   * 默认：源码模式显示、所见即所得模式不显示
   */
  lineNumbers?: boolean | ModeToggles;
  /** 光标所在行是否显示 Markdown 源码（Obsidian/Typora 式），默认 true */
  cursorLineSource?: boolean;
  /**
   * 高亮当前行。boolean = 两种模式统一；ModeToggles = 按模式分开。
   * 默认：源码模式高亮、所见即所得模式不高亮
   */
  highlightActiveLine?: boolean | ModeToggles;
  /** 占位符（空文档时显示） */
  placeholder?: string;
  /** 内容变更回调（唯一数据出口） */
  onChange?: (value: string) => void;
  /** Ctrl/Cmd+S 保存回调 */
  onSave?: () => void;
  /** 点击渲染后的链接回调（宿主负责打开，如浏览器/系统默认程序） */
  onOpenLink?: (url: string) => void;
  /** 图片 URL 解析回调（宿主把本地/相对路径转可加载 URL，如 Tauri asset 协议） */
  resolveImageUrl?: (url: string) => string;
}

/** 编辑器实例 API（框架无关） */
export interface EditorInstance {
  getValue(): string;
  setValue(value: string): void;
  getMode(): EditorMode;
  setMode(mode: EditorMode): void;
  /** 切换行号显示（mode 缺省 = 两种模式统一；指定 mode = 只改该模式并即时生效） */
  setLineNumbers(show: boolean, mode?: EditorMode): void;
  /** 切换"光标所在行显示 Markdown 源码" */
  setCursorLineSource(enabled: boolean): void;
  /** 切换"高亮当前行"（mode 缺省 = 两种模式统一；指定 mode = 只改该模式并即时生效） */
  setHighlightActiveLine(show: boolean, mode?: EditorMode): void;
  /** 动态注册内容变更回调 */
  onChange(cb: (value: string) => void): void;
  /** 动态注册保存回调 */
  onSave(cb: () => void): void;
  /** 动态注册链接点击回调 */
  onOpenLink(cb: (url: string) => void): void;
  /** 动态注册图片 URL 解析回调 */
  setImageUrlResolver(resolve: (url: string) => string): void;
  /** 动态注册光标变化回调（行/列任一变化即触发，用于状态栏与大纲高亮） */
  onCursorChange(cb: (line: number, col: number) => void): void;
  /** 跳转光标到指定位置（大纲点击），center=true 时滚动到视口中央 */
  setCursor(pos: number, center?: boolean): void;
  /** 跳转光标到指定行（1-based；搜索/大纲结果跳转），center=true 时滚动到视口中央 */
  setCursorLine(line: number, center?: boolean): void;
  /** 撤销 / 重做 / 全选（菜单栏） */
  undo(): void;
  redo(): void;
  selectAll(): void;
  /** 打开查找面板（Ctrl+F；面板内置区分大小写/正则/整个单词与替换） */
  find(): void;
  /** 打开替换面板（Ctrl+H / Cmd+Alt+F） */
  findReplace(): void;
  /** 当前选区文本（无选区/光标塌缩时为空串，菜单剪切/复制用） */
  getSelection(): string;
  /** 用文本替换当前选区（无选区时在光标处插入，菜单粘贴用） */
  replaceSelection(text: string): void;
  /** 当前光标行列（状态栏） */
  getCursor(): { line: number; col: number };
  /** 文档大纲：语法树提取标题（跳过代码块） */
  getOutline(): OutlineItem[];
  focus(): void;
  destroy(): void;
}

/* ─────────────────────────── 模式 / 扩展装配 ─────────────────────────── */

/**
 * 代码高亮样式（仅代码 token；不含 heading/link/emphasis 等 Markdown token 规则）：
 * 标题/表头/粗斜体的样式由 WYSIWYG 装饰器负责（md-heading / md-table-header / md-strong / md-em）。
 * 不能直接用 defaultHighlightStyle——它的 heading 规则（textDecoration: underline）会给所有
 * 标题 token 加下划线，且 @lezer/markdown 把表格表头行（TableHeader）也映射为 tags.heading，
 * 导致「标题带下划线」「表格第一行文字带下划线」。这里只保留代码相关标签规则。
 *
 * 颜色用 CSS 变量（var(--hl-*)）承载：应用层在 App.css 按浅色/深色主题定义两组配色，
 * 随 data-theme 自动切换（深色模式下代码高亮同样清晰）。变量缺省时回退浅色默认值。
 */
const mdCodeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--hl-keyword, #708)" },
  { tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName], color: "var(--hl-atom, #219)" },
  { tag: [tags.literal, tags.inserted], color: "var(--hl-literal, #164)" },
  { tag: [tags.string, tags.deleted], color: "var(--hl-string, #a11)" },
  { tag: [tags.regexp, tags.escape, tags.special(tags.string)], color: "var(--hl-regexp, #e40)" },
  { tag: tags.definition(tags.variableName), color: "var(--hl-definition, #00f)" },
  { tag: tags.local(tags.variableName), color: "var(--hl-local, #30a)" },
  { tag: [tags.typeName, tags.namespace], color: "var(--hl-type, #085)" },
  { tag: tags.className, color: "var(--hl-class, #167)" },
  { tag: [tags.special(tags.variableName), tags.macroName], color: "var(--hl-special, #256)" },
  { tag: tags.definition(tags.propertyName), color: "var(--hl-property, #00c)" },
  { tag: tags.comment, color: "var(--hl-comment, #940)" },
  { tag: tags.invalid, color: "var(--hl-invalid, #f00)" },
]);

/**
 * 源码模式专属高亮：代码 token（复用 mdCodeHighlightStyle.specs）+ 标题规则。
 * 源码模式标题按级别区分字号（H1 最大 → H6 最小）、统一玫红色配 + 加粗：
 * - 浅色 --hl-heading: #d94f8a（217,79,138）
 * - 深色 --hl-heading: #f48fb1（提亮同色系，深底对比度好）
 * 注意：颜色/加粗必须写进每个 heading1-6 规则而不能单用 tags.heading ——
 * @lezer/highlight 的 tagHighlighter 对每个节点在 tag.set 里取第一个命中即 break，
 * heading1-6 规则会抢先命中，tags.heading 的样式被跳过。
 * WYSIWYG 模式不能用这套规则：@lezer/markdown 把表格表头（TableHeader）也映射为
 * tags.heading，若在 WYSIWYG 下启用会把表头文字误染/放大（表头样式由 table.ts 负责）。
 * 标题字号/加粗仅作用于标题 token 本身（# 标记 + 文字），不产生下划线。
 */
const mdSourceHighlightStyle = HighlightStyle.define([
  ...mdCodeHighlightStyle.specs,
  { tag: tags.heading1, color: "var(--hl-heading, #d94f8a)", fontWeight: "700", fontSize: "1.7em" },
  { tag: tags.heading2, color: "var(--hl-heading, #d94f8a)", fontWeight: "700", fontSize: "1.45em" },
  { tag: tags.heading3, color: "var(--hl-heading, #d94f8a)", fontWeight: "700", fontSize: "1.25em" },
  { tag: tags.heading4, color: "var(--hl-heading, #d94f8a)", fontWeight: "700", fontSize: "1.1em" },
  { tag: tags.heading5, color: "var(--hl-heading, #d94f8a)", fontWeight: "700", fontSize: "1em" },
  { tag: tags.heading6, color: "var(--hl-heading, #d94f8a)", fontWeight: "700", fontSize: "0.9em" },
]);

/** WYSIWYG 模式开关（wysiwygPlugin 定义于 ./wysiwyg/plugin.ts） */
const wysiwygCompartment = new Compartment();

/** 源码模式专属扩展（语法高亮），WYSIWYG 模式下关闭 */
const sourceOnlyCompartment = new Compartment();

/** 行号独立控制（任何模式下都可用开关控制） */
const lineNumbersCompartment = new Compartment();

/** 当前行高亮独立控制（任何模式下都可用开关控制，默认关闭） */
const activeLineCompartment = new Compartment();

/** 代码块闭合行行号隐藏（仅 WYSIWYG 生效，随模式开关） */
const gutterCloseCompartment = new Compartment();

/** WYSIWYG 模式扩展内容（裸扩展，供 compartment.of / reconfigure 使用） */
function wysiwygModeContent(): Extension {
  return [wysiwygPlugin, tableToolbarPlugin, syntaxHighlighting(mdCodeHighlightStyle)];
}

/** 源码模式扩展内容（裸扩展，供 compartment.of / reconfigure 使用） */
function sourceModeContent(): Extension {
  return [syntaxHighlighting(mdSourceHighlightStyle)];
}

/** 根据模式返回编辑器扩展（WYSIWYG 附加语法高亮，供代码块内高亮） */
function modeExtension(mode: EditorMode): Extension {
  return wysiwygCompartment.of(mode === "wysiwyg" ? wysiwygModeContent() : []);
}

/** 源码模式专属扩展（语法高亮：代码 token + 标题大小/配色；当前行高亮由 activeLineCompartment 独立控制） */
function sourceOnlyExtension(mode: EditorMode): Extension {
  return sourceOnlyCompartment.of(mode === "source" ? sourceModeContent() : []);
}

/** 行号扩展内容（裸扩展，供 compartment.of / reconfigure 使用） */
function lineNumbersContent(show: boolean): Extension {
  return show ? lineNumbers() : [];
}

/** 当前行高亮扩展内容（裸扩展，供 compartment.of / reconfigure 使用） */
function activeLineContent(show: boolean): Extension {
  return show ? highlightActiveLine() : [];
}

/**
 * 折叠行（代码块闭合 ```）的行号隐藏：WYSIWYG 下闭合行内容折叠为 0 高，
 * 但行号栏该行仍显示行号并占行高（与下一行行号重叠/错位，如 56/57）。
 * gutterLineClass 给闭合行的行号元素加 md-gutter-close 类，
 * CSS 用 display:none 隐藏并去掉占位（gutter 总高与内容对齐）。
 * 仅 WYSIWYG 生效（gutterCloseCompartment 随模式开关）。
 */
class CodeCloseGutterMarker extends GutterMarker {
  elementClass = "md-gutter-close";
  eq() {
    return true;
  }
}
const codeCloseGutterLineClass = gutterLineClass.compute(["doc"], (state) => {
  const marks: Range<GutterMarker>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return;
      const startLine = state.doc.lineAt(node.from).number;
      const endLine = nodeEndLine(state.doc, node.from, node.to);
      if (endLine > startLine && FENCE_CLOSE_RE.test(state.doc.line(endLine).text)) {
        marks.push(new CodeCloseGutterMarker().range(state.doc.line(endLine).from));
      }
    },
  });
  return RangeSet.of(marks);
});

/** 行号扩展（独立于模式；compartment.of 包装，仅创建时使用） */
function lineNumbersExtension(show: boolean): Extension {
  return lineNumbersCompartment.of(lineNumbersContent(show));
}

/** 当前行高亮扩展（独立于模式；compartment.of 包装，仅创建时使用） */
function activeLineExtension(show: boolean): Extension {
  return activeLineCompartment.of(activeLineContent(show));
}

/** 代码块闭合行行号隐藏扩展（仅 WYSIWYG；compartment.of 包装，仅创建时使用） */
function gutterCloseExtension(mode: EditorMode): Extension {
  return gutterCloseCompartment.of(mode === "wysiwyg" ? [codeCloseGutterLineClass] : []);
}

/** 归一化按模式开关：boolean = 两模式统一；对象 = 按模式，缺省字段用默认值 */
function normalizeModeToggles(v: boolean | ModeToggles | undefined, def: ModeToggles): ModeToggles {
  if (typeof v === "boolean") return { source: v, wysiwyg: v };
  if (v) return { source: v.source ?? def.source, wysiwyg: v.wysiwyg ?? def.wysiwyg };
  return { ...def };
}

/* ─────────────────────────── createEditor ─────────────────────────── */

/** 图片源码编辑覆盖层（WYSIWYG 下点击图片在图上编辑 ![alt](url)）
 * Ctrl+S / Ctrl+Enter 写回并触发保存（显式保存）；Esc 取消；失焦仅写回（标记未保存，不自动保存）。
 * 覆盖层跟随滚动/缩放一起移动（监听编辑区 scroll 与窗口 resize 实时重新定位到图片）。 */
let imageOverlay: HTMLDivElement | null = null;
let imageOverlayCleanup: (() => void) | null = null;
function closeImageOverlay(
  writeBack: boolean,
  save: boolean,
  view: EditorView,
  from: number,
  to: number,
  original: string,
  saveHandler?: () => void,
) {
  if (!imageOverlay) return;
  const overlay = imageOverlay;
  imageOverlay = null;
  // 清理滚动/缩放监听
  imageOverlayCleanup?.();
  imageOverlayCleanup = null;
  const text = overlay.textContent ?? "";
  overlay.remove();
  if (writeBack && text !== original) {
    // 写回文档：触发 onChange → 宿主置 dirty（未保存标记，与普通内容修改一致）
    view.dispatch({ changes: { from, to, insert: text }, userEvent: "input" });
    // 仅显式 Ctrl+S / Ctrl+Enter 才触发保存；blur 等失焦只标记未保存，不自动保存
    if (save) saveHandler?.();
  }
  // 关闭后焦点回到编辑器，后续 Ctrl+S 才能由编辑器保存
  view.focus();
}
function openImageOverlay(view: EditorView, el: HTMLElement, saveHandler?: () => void) {
  // 已有一个覆盖层：先关闭（不写回，避免误提交）
  if (imageOverlay) closeImageOverlay(false, false, view, 0, 0, "");
  const from = Number(el.dataset.from);
  const to = Number(el.dataset.to);
  if (Number.isNaN(from) || Number.isNaN(to)) return;
  const original = view.state.doc.sliceString(from, to);
  // 覆盖层宽度与 CodeMirror 编辑区(contentDOM)一致,左边与编辑区对齐
  const overlay = document.createElement("div");
  overlay.className = "md-image-overlay";
  overlay.contentEditable = "true";
  overlay.textContent = original;
  // 定位到图片(跟随滚动)：左缘对齐编辑区、顶部对齐图片、宽度=编辑区宽度
  // 图片滚出编辑区可视范围(含滚到菜单栏/工具条以上)时隐藏覆盖层，避免残影
  const position = () => {
    const r = el.getBoundingClientRect();
    const sc = view.scrollDOM.getBoundingClientRect();
    // 用【图片顶部】判断：顶部一进入编辑区顶(即菜单栏底)就隐藏，
    // 避免图片顶部已滚进菜单栏、底部还在编辑区时覆盖层仍压在菜单栏上
    const inView = r.top > sc.top + 2 && r.top < sc.bottom - 2;
    if (!inView) {
      overlay.style.display = "none";
      return;
    }
    const cr = view.contentDOM.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.left = cr.left + "px";
    overlay.style.top = r.top + "px";
    overlay.style.width = cr.width + "px";
  };
  position();
  overlay.spellcheck = false;
  document.body.appendChild(overlay);
  imageOverlay = overlay;
  // 滚动/缩放时跟随图片一起移动
  view.scrollDOM.addEventListener("scroll", position);
  window.addEventListener("resize", position);
  imageOverlayCleanup = () => {
    view.scrollDOM.removeEventListener("scroll", position);
    window.removeEventListener("resize", position);
  };
  overlay.focus();
  // 全选，方便直接改整段源码
  const gs = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(overlay);
  gs?.removeAllRanges();
  gs?.addRange(range);
  const close = (writeBack: boolean, save: boolean) =>
    closeImageOverlay(writeBack, save, view, from, to, original, saveHandler);
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(false, false);
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      close(true, true);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      close(true, true);
    }
  });
  // 失焦（点击别处）：仅写回标记未保存，不自动保存
  overlay.addEventListener("blur", () => close(true, false));
}

/**
 * 创建 Markdown 编辑器实例（CodeMirror 6）
 * - 源码模式：纯 Markdown 源码
 * - WYSIWYG 模式：隐藏语法标记 + 实时样式（Live Preview，见 ./wysiwyg/）
 */
export function createEditor(el: HTMLElement, options: EditorOptions = {}): EditorInstance {
  let changeHandler = options.onChange;
  let saveHandler = options.onSave;
  let openLinkHandler = options.onOpenLink;
  let cursorHandler: ((line: number, col: number) => void) | null = null;
  // 图片 URL 解析（模块级注入，见 ./wysiwyg/widgets.ts setImageUrlResolver）
  setImageUrlResolver(options.resolveImageUrl ?? null);
  let currentMode: EditorMode = options.mode ?? "wysiwyg";
  // 行号 / 高亮当前行：按模式分开（boolean 选项 = 两种模式统一）
  const lineNumbersState: ModeToggles = normalizeModeToggles(options.lineNumbers, { source: true, wysiwyg: false });
  const activeLineState: ModeToggles = normalizeModeToggles(options.highlightActiveLine, { source: true, wysiwyg: false });
  let lastCursorLine = -1;
  let lastCursorCol = -1;
  // 光标行源码开关当前值（重建 state 时恢复，cursorLineSourceStateField 默认 true）
  let cursorLineSourceEnabled = options.cursorLineSource ?? true;

  /** 编辑器扩展配置（重建 state 时重新求值：模式/行号/高亮等取闭包当前值） */
  function buildExtensions(): Extension[] {
    return [
      history(),
      // 必须显式用 markdownLanguage（完整 GFM：表格/任务列表/删除线），
      // markdown() 默认的 CommonMark 不支持表格
      // codeLanguages：围栏代码块按语言同步解析（legacy StreamLanguage），配合
      // syntaxHighlighting 实现代码高亮（见 ./wysiwyg/codeLanguages.ts）
      markdown({ base: markdownLanguage, codeLanguages }),
      // 折叠（代码块等）：foldState 注册 + FencedCode 折叠服务
      // 注意：preparePlaceholder 提供非空值给 placeholderDOM（默认 FoldWidget 传 null）
      codeFolding({
        preparePlaceholder: (state, range) => {
          return Math.max(0, state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number);
        },
        placeholderDOM: (_view, onclick, prepared) => {
          const span = document.createElement("span");
          span.className = "cm-foldPlaceholder";
          span.textContent = `⋯ 已折叠（${prepared} 行）`;
          span.onclick = onclick;
          return span;
        },
      }),
      codeFoldService(),
      drawSelection(),
      EditorView.lineWrapping,
      ...(options.placeholder ? [cmPlaceholder(options.placeholder)] : []),
      // 列表回车续行（Prec.highest 覆盖 markdown() 内置 Enter 续行）：
      // - 空列表项（仅标记）：移除标记，退出列表（Typora 同款）
      // - 有内容的列表项：插入 "\n" + 同缩进标记（有序 +1，任务项续 "- [ ] "），
      //   不额外插入空行（修正 CM nonTightList 在松散列表中多加一个空行的问题）
      // - 非列表行：返回 false 交给默认续行（段落/引用等）
      Prec.highest(
        keymap.of([
          {
            key: "Enter",
            run: (view) => {
              const { state } = view;
              const sel = state.selection.main;
              if (!sel.empty) return false;
              const line = state.doc.lineAt(sel.head);

              // 空列表项：移除标记（退出列表，得到空行）
              const empty = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s*)?$/.exec(line.text);
              if (empty && sel.head >= line.from + empty[0].length) {
                view.dispatch({
                  changes: { from: line.from, to: line.from + empty[0].length, insert: "" },
                  selection: { anchor: line.from },
                  userEvent: "input",
                });
                return true;
              }

              // 列表项续行：仅当光标在标记之后
              const m = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s*)?/.exec(line.text);
              if (m && sel.head >= line.from + m[0].length) {
                let marker = m[2];
                if (/^\d+$/.test(marker.replace(/[.)]$/, ""))) {
                  marker = String(parseInt(marker, 10) + 1) + marker.slice(marker.length - 1);
                }
                const task = m[4] ? "[ ] " : "";
                const insert = "\n" + m[1] + marker + " " + task;
                view.dispatch({
                  changes: { from: sel.head, insert },
                  selection: { anchor: sel.head + insert.length },
                  userEvent: "input",
                });
                return true;
              }
              return false; // 非列表：交给默认续行
            },
          },
        ]),
      ),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
        ...searchKeymap,
        {
          key: "Mod-s",
          run: () => {
            saveHandler?.();
            return true;
          },
        },
      ]),
      // 编辑器内查找/替换（VS Code 式）：面板置顶，自带
      // 「区分大小写 / 正则表达式 / 整个单词」切换按钮与替换区
      search({ top: true }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          changeHandler?.(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head;
          const ln = update.state.doc.lineAt(head);
          const line = ln.number;
          const col = head - ln.from + 1;
          if (line !== lastCursorLine || col !== lastCursorCol) {
            lastCursorLine = line;
            lastCursorCol = col;
            cursorHandler?.(line, col);
          }
        }
      }),
      // 任务列表复选框：点击切换 [ ] ↔ [x]（仅 WYSIWYG 下存在 .md-task-checkbox DOM）
      EditorView.domEventHandlers({
        mousedown: (event, view) => {
          const target = event.target as HTMLElement | null;
          // 点击渲染后的链接：打开浏览器并阻止光标移动——
          // 若让光标进入该行，行会切到源码显示（链接装饰消失），点击即失效
          const link = target?.closest?.(".md-link") as HTMLElement | null;
          if (link) {
            const url = link.dataset.url;
            if (url && openLinkHandler) openLinkHandler(url);
            return true; // preventDefault：不移动光标，链接保持渲染可继续悬停
          }
          // 点击图片：不切回源码，而是在图上打开源码编辑覆盖层（编辑后可 Ctrl+S 保存）
          // (成功图 .md-image / 失败图 .md-image-error 均为可点击，打开同一编辑覆盖层)
          const img = target?.closest?.(".md-image, .md-image-error") as HTMLElement | null;
          if (img) {
            openImageOverlay(view, img, saveHandler);
            return true;
          }
          if (!target || !target.closest(".md-task-checkbox")) {
            // 点击表格单元格：确定性光标定位（Typora 式，见 table.ts tableCellTargetPos）。
            // 在 mousedown 即修正——CM6 posAtCoords 对 flex 单元格内换行文本定位不准
            // （点击最后一行会映射到上一行），若等 click 再修正，光标会"先出现在
            // 上一行、再闪到点击处"。与 CM 默认位置一致时不干预（保留原生拖选）。
            const cell = target?.closest?.(".md-table-cell") as HTMLElement | null;
            if (cell && cell.dataset.from != null) {
              const pos = tableCellTargetPos(view, cell, event.clientX, event.clientY);
              const cmPos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
              if (pos !== cmPos) {
                view.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
                return true; // preventDefault：阻止默认的坐标→位置映射
              }
            }
            // 点击表格分隔行(表头下方空行)：光标不要进入该空行，而是重定向到
            // 同列的上方表头(或下方首个数据)单元格
            const dividerLine = target?.closest?.(".cm-line.md-table-divider") as HTMLElement | null;
            if (dividerLine) {
              const row = (dividerLine.previousElementSibling || dividerLine.nextElementSibling) as HTMLElement | null;
              if (row) {
                const c = Array.from(row.querySelectorAll<HTMLElement>(".md-table-cell")).find((el) => {
                  const r = el.getBoundingClientRect();
                  return event.clientX >= r.left && event.clientX <= r.right;
                });
                if (c && c.dataset.from != null) {
                  const pos = tableCellTargetPos(view, c, event.clientX, event.clientY);
                  view.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
                  return true;
                }
              }
            }
            return false;
          }
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
          if (pos == null) return true;
          const line = view.state.doc.lineAt(pos);
          const m = /^(\s*[-*+]\s+)\[([ xX])\]/.exec(line.text);
          if (!m) return true;
          const start = line.from + m[1].length;
          view.dispatch({
            changes: { from: start, to: start + 3, insert: m[2] === " " ? "[x]" : "[ ]" },
            selection: { anchor: pos },
            userEvent: "input",
          });
          return true;
        },
        // 点击渲染后的链接：交给宿主（onOpenLink）打开（非鼠标触发的 click 兜底）
        // 点击表格单元格：确定性光标定位（Typora 式）——点击该行文字左侧（不论
        // 远近）→ 光标到行首；右侧（不论远近）→ 行末；文字上 → 最近字符。
        // 放 click 而非 mousedown：mousedown 不干预可保留原生拖选/选择，拖选后
        // selection 非塌缩，此处自动跳过（不打断选择）
        click: (event, view) => {
          const target = event.target as HTMLElement | null;
          const link = target?.closest?.(".md-link") as HTMLElement | null;
          if (link) {
            const url = link.dataset.url;
            if (url && openLinkHandler) openLinkHandler(url);
            return true;
          }
          // 图片点击：覆盖层已在 mousedown 打开，这里 preventDefault 防止光标落到图片行切源码
          if (target?.closest?.(".md-image, .md-image-error")) return true;
          const cell = target?.closest?.(".md-table-cell") as HTMLElement | null;
          if (cell && cell.dataset.from != null) {
            const sel = view.state.selection.main;
            if (sel.empty) {
              const pos = tableCellTargetPos(view, cell, event.clientX, event.clientY);
              if (pos !== sel.head) {
                view.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
              }
            }
            return true;
          }
          return false;
        },
      }),
      modeExtension(currentMode),
      sourceOnlyExtension(currentMode),
      lineNumbersExtension(lineNumbersState[currentMode]),
      activeLineExtension(activeLineState[currentMode]),
      gutterCloseExtension(currentMode),
      cursorLineSourceStateField,
    ];
  }

  const state = EditorState.create({
    doc: options.value ?? "",
    extensions: buildExtensions(),
  });

  const view = new EditorView({ state, parent: el });
  // 初始选项：光标行源码显示默认开启，false 时通过 effect 关闭
  if (options.cursorLineSource === false) {
    cursorLineSourceEnabled = false;
    view.dispatch({ effects: setCursorLineSource.of(false) });
  }

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (value: string) => {
      const current = view.state.doc.toString();
      if (value === current) return;
      // 重建 state（打开/新建/外部重载等整篇替换场景）：
      // 1) 替换本身不进入撤销历史——避免"打开文件后 Ctrl+Z 把内容删空"；
      // 2) 清空上一文档的撤销/重做历史——撤销到最早一步后不再有可撤销项（而非删内容）
      view.setState(
        EditorState.create({
          doc: value,
          selection: { anchor: 0 },
          extensions: buildExtensions(),
        }),
      );
      if (!cursorLineSourceEnabled) view.dispatch({ effects: setCursorLineSource.of(false) });
    },
    getMode: () => currentMode,
    setMode: (mode: EditorMode) => {
      if (mode === currentMode) return;
      currentMode = mode;
      view.dispatch({
        effects: [
          wysiwygCompartment.reconfigure(mode === "wysiwyg" ? wysiwygModeContent() : []),
          sourceOnlyCompartment.reconfigure(mode === "source" ? sourceModeContent() : []),
          // 行号/高亮跟随模式各自的设置（reconfigure 传裸扩展，不含 .of 包装）
          lineNumbersCompartment.reconfigure(lineNumbersContent(lineNumbersState[mode])),
          activeLineCompartment.reconfigure(activeLineContent(activeLineState[mode])),
          gutterCloseCompartment.reconfigure(mode === "wysiwyg" ? [codeCloseGutterLineClass] : []),
        ],
      });
    },
    setLineNumbers: (show: boolean, mode?: EditorMode) => {
      if (mode) {
        if (lineNumbersState[mode] === show) return;
        lineNumbersState[mode] = show;
      } else {
        if (lineNumbersState.source === show && lineNumbersState.wysiwyg === show) return;
        lineNumbersState.source = show;
        lineNumbersState.wysiwyg = show;
      }
      // 当前模式受影响才重配
      const affected = !mode || mode === currentMode;
      if (affected) {
        view.dispatch({
          effects: lineNumbersCompartment.reconfigure(lineNumbersContent(lineNumbersState[currentMode])),
        });
      }
    },
    setCursorLineSource: (enabled: boolean) => {
      cursorLineSourceEnabled = enabled;
      view.dispatch({ effects: setCursorLineSource.of(enabled) });
    },
    setHighlightActiveLine: (show: boolean, mode?: EditorMode) => {
      if (mode) {
        if (activeLineState[mode] === show) return;
        activeLineState[mode] = show;
      } else {
        if (activeLineState.source === show && activeLineState.wysiwyg === show) return;
        activeLineState.source = show;
        activeLineState.wysiwyg = show;
      }
      const affected = !mode || mode === currentMode;
      if (affected) {
        view.dispatch({
          effects: activeLineCompartment.reconfigure(activeLineContent(activeLineState[currentMode])),
        });
      }
    },
    onChange: (cb) => {
      changeHandler = cb;
    },
    onSave: (cb) => {
      saveHandler = cb;
    },
    onOpenLink: (cb) => {
      openLinkHandler = cb;
    },
    setImageUrlResolver: (resolve) => {
      setImageUrlResolver(resolve);
    },
    onCursorChange: (cb) => {
      cursorHandler = cb;
    },
    setCursor: (pos: number, center = true) => {
      const clamped = Math.max(0, Math.min(view.state.doc.length, pos));
      view.dispatch({
        selection: { anchor: clamped },
        userEvent: "select.pointer",
        effects: EditorView.scrollIntoView(clamped, center ? { y: "center", yMargin: 48 } : undefined),
      });
      view.focus();
    },
    setCursorLine: (line: number, center = true) => {
      const ln = Math.max(1, Math.min(view.state.doc.lines, line));
      const pos = view.state.doc.line(ln).from;
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, center ? { y: "center", yMargin: 48 } : undefined),
      });
      view.focus();
    },
    undo: () => undo(view),
    redo: () => redo(view),
    selectAll: () => selectAll(view),
    find: () => {
      view.focus();
      openSearchPanel(view);
    },
    findReplace: () => {
      // 打开查找面板（面板内含替换输入区，展开即可替换）
      view.focus();
      openSearchPanel(view);
    },
    getSelection: () => {
      const { from, to } = view.state.selection.main;
      return view.state.sliceDoc(from, to);
    },
    replaceSelection: (text: string) => {
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    },
    getCursor: () => {
      const head = view.state.selection.main.head;
      const ln = view.state.doc.lineAt(head);
      return { line: ln.number, col: head - ln.from + 1 };
    },
    getOutline: () => {
      const tree = syntaxTree(view.state);
      const doc = view.state.doc;
      const items: OutlineItem[] = [];
      tree.iterate({
        enter: (node) => {
          const n = node.name;
          // 跳过代码块/HTML 块/注释：其中的 # 不是标题
          if (n === "FencedCode" || n === "CodeBlock" || n === "HTMLBlock" || n === "Comment") {
            return false;
          }
          let level = 0;
          if (n.startsWith("ATXHeading")) {
            level = Number(n.slice("ATXHeading".length));
          } else if (n === "SetextHeading1") {
            level = 1;
          } else if (n === "SetextHeading2") {
            level = 2;
          } else {
            return;
          }
          const from = node.from;
          const line = doc.lineAt(from);
          let text: string;
          if (n.startsWith("ATXHeading")) {
            text = doc
              .sliceString(from, node.to)
              .replace(/^#{1,6}\s*/, "")
              .replace(/\s+#+\s*$/, "")
              .trim();
          } else {
            text = line.text.trim();
          }
          if (text) {
            items.push({ level, text, line: line.number, pos: from });
          }
        },
      });
      return items;
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

// 图片/链接 URL 解析器（框架无关纯函数，供宿主注入/复用，见 ./wysiwyg/widgets.ts）
export { assetImageUrlResolver, normalizeLocalPath } from "./wysiwyg/widgets";
