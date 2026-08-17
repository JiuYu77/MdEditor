/**
 * WYSIWYG 装饰构建（@mdeditor/md-editor 内部）
 * 隐藏语法标记 + 应用实时样式；仅遍历可见范围（大文档 O(可见行)）
 */
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { BulletWidget, OrderedItemWidget, TaskCheckboxWidget, ImageWidget, LinkWidget, HrWidget } from "./widgets";
import { CodeBlockToolbarWidget } from "./codeBlock";
import { buildTableDecorations } from "./table";
import { FENCE_CLOSE_RE, FENCE_OPEN_RE, nodeEndLine } from "./tree";

/** 隐藏语法标记（占位但透明，保持光标/选区正确） */
const hideMark = Decoration.mark({ class: "md-hide-mark" });

/** 标题级别 → 样式类 */
const headingClass: Record<number, string> = {
  1: "md-heading md-heading-1",
  2: "md-heading md-heading-2",
  3: "md-heading md-heading-3",
  4: "md-heading md-heading-4",
  5: "md-heading md-heading-5",
  6: "md-heading md-heading-6",
};

/**
 * 构建 WYSIWYG 装饰：隐藏语法标记 + 应用实时样式（仅遍历可见范围，大文档 O(可见行)）
 * @param cursorLine 光标所在行（>0 时该行不做任何装饰，显示原始 Markdown 源码，Obsidian/Typora 式；0 = 关闭）
 */
export function buildWysiwygDecorations(view: EditorView, cursorLine = 0): DecorationSet {
  try {
    const tree = syntaxTree(view.state);
    const doc = view.state.doc;
    // 先收集所有装饰，最后按 (from, startSide) 统一排序添加——
    // 解决 tree.iterate 父先子后与 RangeSetBuilder 升序要求的结构性冲突
    const items: { from: number; to: number; deco: Decoration }[] = [];
    // 围栏代码块的所有行号（FencedCode 分支先于子节点访问时填充，供 CodeMark/光标行判断）
    const fenceLines = new Set<number>();
    // 标题行号（供光标行判断：标题行不显示源码，而是左侧显示级别提示）
    const headingLines = new Set<number>();
    // 表格行号（供光标行判断：表格聚焦时保持渲染，不加源码底色）
    const tableLines = new Set<number>();

    /** 是否为标题相关节点（光标行不再显示源码，保持渲染 + 级别提示） */
    const isHeadingNode = (name: string): boolean =>
      name.startsWith("ATXHeading") || name === "SetextHeading1" || name === "SetextHeading2" || name === "HeaderMark";

    /** 处理单个语法节点，收集装饰 */
    const process = (node: { name: string; from: number; to: number }) => {
      const { name, from, to } = node;
      const nodeLine = doc.lineAt(from).number;

      // 光标所在行：不做装饰（保留 Markdown 源码可见）——
      // 但代码围栏、标题、表格除外：代码块始终渲染为容器（不显示源码，语言经工具栏切换）；
      // 标题行不显示源码，改为左侧显示级别提示（H1~H6）；
      // 表格行聚焦时保持渲染（配合表格操作工具条，见 table.ts）
      if (
        cursorLine > 0 &&
        nodeLine === cursorLine &&
        name !== "FencedCode" &&
        !fenceLines.has(nodeLine) &&
        !isHeadingNode(name) &&
        name !== "Table"
      )
        return;

      // 标题：# 标记移除（不占位，标题顶格）+ 标题文字加样式
      if (name === "HeaderMark") {
        const markText = doc.sliceString(from, to);
        if (/^#{1,6}$/.test(markText)) {
          // ATX：# 后跟空格才算标题标记，隐藏 "# "（顶格）；
          // 单独 "#"（无空格，如刚输入一个 #）未确认是标题，保留 # 显示
          if (doc.sliceString(to, to + 1) === " ") {
            items.push({ from, to: to + 1, deco: Decoration.replace({}) });
          }
        } else {
          // Setext 的 "=====" / "-----" 整行标记移除
          items.push({ from, to, deco: Decoration.replace({}) });
        }
      } else if (name.startsWith("ATXHeading")) {
        const level = Number(name.slice("ATXHeading".length));
        // 待定标题（# 后无空格，如单独 "#"）：保留 # 显示，不加标题样式/级别提示
        if (doc.sliceString(from + level, from + level + 1) !== " ") return;
        items.push({ from, to, deco: Decoration.mark({ class: headingClass[level] ?? "md-heading" }) });
        // 光标所在标题行：左侧显示级别提示（H1~H6）
        headingLines.add(nodeLine);
        if (nodeLine === cursorLine) {
          const ls = doc.lineAt(from).from;
          items.push({
            from: ls,
            to: ls,
            deco: Decoration.line({ class: `md-heading-cursor md-heading-cursor-${level}` }),
          });
        }
      }
      // Setext 标题（文字下一行的 = / - 是下划线标记，由上方 HeaderMark 分支隐藏）：
      // 只给标题文字（首行）加样式——整节点 [from,to] 会跨到下一行，
      // 若加样式会把下划线行也撑高；下划线行折叠为 0 高（不占空行）
      else if (name === "SetextHeading1" || name === "SetextHeading2") {
        const level = name === "SetextHeading1" ? 1 : 2;
        const lineTo = doc.lineAt(from).to;
        items.push({ from, to: lineTo, deco: Decoration.mark({ class: headingClass[level] ?? "md-heading" }) });
        const underlineLineStart = doc.lineAt(Math.max(from, to - 1)).from;
        items.push({ from: underlineLineStart, to: underlineLineStart, deco: Decoration.line({ class: "md-setext-underline" }) });
        // 光标所在标题行：左侧显示级别提示（H1~H6）
        const textLine = doc.lineAt(from);
        headingLines.add(textLine.number);
        if (textLine.number === cursorLine) {
          items.push({
            from: textLine.from,
            to: textLine.from,
            deco: Decoration.line({ class: `md-heading-cursor md-heading-cursor-${level}` }),
          });
        }
      }

      // 引用：> 标记完全移除（引用顶格）+ 引用行加 Typora/GitHub 式左边框与淡背景；
      // 嵌套引用（>>）按级别加深背景（md-quote-2 / md-quote-3）
      else if (name === "QuoteMark") {
        items.push({ from, to, deco: Decoration.replace({}) });
        const line = doc.lineAt(from);
        // 连续 > 的数量即嵌套级别（^\s*>+ 取行首连续引用标记）
        const m = line.text.match(/^\s*>+/);
        const level = m ? m[0].trim().length : 1;
        items.push({
          from: line.from,
          to: line.from,
          deco: Decoration.line({ class: "md-quote" + (level > 1 ? ` md-quote-${Math.min(level, 3)}` : "") }),
        });
      }

      // 列表：任务列表（- [ ]）标记透明由复选框替代；有序显示数字；无序显示圆点；
      // 空列表项也显示圆点（Typora 式，避免续行看起来像空行/乱行）；
      // 仅整行就是单个 "-"（无缩进无尾随空格）保留原样（"单 - 显示"需求）
      else if (name === "ListMark") {
        const text = doc.sliceString(from, to);
        const after = doc.sliceString(to, Math.min(to + 5, doc.length));
        if (after.match(/^\s*\[[ xX]\]/)) {
          items.push({ from, to, deco: hideMark });
        } else if (/^\d+[.)]$/.test(text)) {
          items.push({ from, to, deco: Decoration.replace({ widget: new OrderedItemWidget(text) }) });
        } else if (after.trim() === "") {
          const lineText = doc.lineAt(from).text;
          if (/^-$/.test(lineText)) {
            // 单独的 "-"：保留原样显示
          } else {
            items.push({ from, to, deco: Decoration.replace({ widget: new BulletWidget() }) });
          }
        } else {
          items.push({ from, to, deco: Decoration.replace({ widget: new BulletWidget() }) });
        }
      }

      // 任务列表：[x] / [ ] 替换为复选框
      else if (name === "TaskMarker") {
        const text = doc.sliceString(from, to);
        items.push({
          from,
          to,
          deco: Decoration.replace({ widget: new TaskCheckboxWidget(/^\[[xX]\]$/.test(text)) }),
        });
      }

      // 任务列表内容：已勾选 → 灰色 + 删除线（Typora 风格）
      else if (name === "Task") {
        const text = doc.sliceString(from, to);
        if (/^\[[xX]\]/.test(text)) {
          items.push({ from: from + 3, to, deco: Decoration.mark({ class: "md-task-done" }) });
        }
      }

      // 表格：整表渲染（表头底 + 斑马纹 + 1px 分隔线 + 列宽对齐竖线 + 操作工具条），见 table.ts
      // 注意：行装饰必须是「行首位置上的零长度区间」——若用 [from,to] 非空区间添加，
      // CodeMirror 的 tile 渲染器会把整行文本跳过（DOM 只剩 <br>），并损坏高度图
      else if (name === "Table") {
        buildTableDecorations(view, doc, from, to, items);
        // 记录表格行号（光标指示排除：表格行聚焦时不加源码底色）
        const tf = doc.lineAt(from).number;
        const tl = nodeEndLine(doc, from, to);
        for (let ln = tf; ln <= tl; ln++) tableLines.add(ln);
        return true; // 表格内部节点已由 table.ts 统一处理，跳过子节点
      }

      // 代码围栏整块（Typora 风格容器）：
      // - 每行加 md-code-block（背景 + 等宽字体），首行/末行加圆角类
      // - 内容行加 md-code-line（块内行号，CSS 计数器），首内容行重置计数
      // - 开头的 ``` 标记替换为工具栏（折叠 / 语言切换 / 复制，见 codeBlock.ts）
      // - 闭合的 ``` 标记完全移除，其行折叠为 0 高（圆角收在最后一行代码上）
      // - 语言经工具栏切换，因此代码块始终渲染、不随光标显示源码
      else if (name === "FencedCode") {
        const startLine = doc.lineAt(from);
        const endLine = doc.lineAt(nodeEndLine(doc, from, to));
        const markerMatch = FENCE_OPEN_RE.exec(startLine.text);
        const markerLen = markerMatch ? markerMatch[1].length : 3;
        const lang = startLine.text.slice(markerLen).trim();

        // 记录围栏行号（供 CodeMark / 光标行判断跳过）
        for (let ln = startLine.number; ln <= endLine.number; ln++) fenceLines.add(ln);

        // 末行是否为闭合围栏（仅含 ```/~~~ 及可选空白，且与起始行不同行）
        const closingMatch = FENCE_CLOSE_RE.exec(endLine.text);
        const hasClosing = closingMatch !== null && endLine.number > startLine.number;
        // 视觉末行：有闭合围栏时取最后一行代码（背景/圆角收在代码上，闭合行折叠隐藏）
        const visualEnd = hasClosing ? endLine.number - 1 : endLine.number;

        // 行装饰：首 / 内容 / 末
        let contentIndex = 0;
        for (let ln = startLine.number; ln <= endLine.number; ln++) {
          const l = doc.line(ln);
          let cls = "md-code-block";
          if (ln === startLine.number) cls += " md-code-block-start";
          if (ln === visualEnd) cls += " md-code-block-end";
          if (ln > startLine.number && ln < endLine.number) {
            cls += " md-code-line" + (contentIndex === 0 ? " md-code-line-first" : "");
            contentIndex++;
          }
          items.push({ from: l.from, to: l.from, deco: Decoration.line({ class: cls }) });
        }

        // 工具栏替换开头的围栏标记
        if (markerLen > 0) {
          items.push({
            from,
            to: from + markerLen,
            deco: Decoration.replace({ widget: new CodeBlockToolbarWidget(lang) }),
          });
        }

        // 闭合围栏：完全移除（前后 ``` 都不显示），所在行折叠为 0 高
        if (hasClosing) {
          items.push({ from: endLine.from, to: endLine.to, deco: Decoration.replace({}) });
          items.push({ from: endLine.from, to: endLine.from, deco: Decoration.line({ class: "md-code-close" }) });
        }
      }

      // 行内代码反引号：完全移除（围栏标记已在 FencedCode 分支处理，此处跳过围栏行）
      else if (name === "CodeMark") {
        if (fenceLines.has(nodeLine)) return;
        items.push({ from, to, deco: Decoration.replace({}) });
      } else if (name === "CodeInfo") {
        // 语言文本由工具栏 chip 展示：围栏行也完全移除，
        // 否则 ```c 首行会显示 chip "c" + 原文 "c" 两个（用户反馈 "C c" 即此残留）
        items.push({ from, to, deco: Decoration.replace({}) });
      }

      // 分割线（--- / *** / ___）：整行替换为横线元素（Typora 式）
      else if (name === "HorizontalRule") {
        items.push({ from, to, deco: Decoration.replace({ widget: new HrWidget() }) });
      }

      // 转义符（\* \# \~ 等）：隐藏反斜杠，仅显示转义后的字符
      // （Escape 节点 [from,to] 覆盖 "\X" 两个字符，只移除第一个反斜杠）
      else if (name === "Escape") {
        items.push({ from, to: from + 1, deco: Decoration.replace({}) });
      }

      // 删除线（GFM ~~text~~）：~~ 标记移除 + 内容加删除线样式
      else if (name === "Strikethrough") {
        items.push({ from, to, deco: Decoration.mark({ class: "md-strike" }) });
      } else if (name === "StrikethroughMark") {
        items.push({ from, to, deco: Decoration.replace({}) });
      }

      // 粗体/斜体：开闭标记完全移除（不占位留空）+ 内容加样式
      else if (name === "StrongEmphasis" || name === "Emphasis") {
        const isStrong = name === "StrongEmphasis";
        const m = doc.sliceString(from, to).match(isStrong ? /^(\*{2}|_{2})([\s\S]*?)(\*{2}|_{2})$/ : /^([*_])([\s\S]*?)([*_])$/);
        if (m) {
          const openLen = m[1].length;
          const closeLen = m[3].length;
          items.push({ from, to: from + openLen, deco: Decoration.replace({}) });
          items.push({
            from: from + openLen,
            to: to - closeLen,
            deco: Decoration.mark({ class: isStrong ? "md-strong" : "md-em" }),
          });
          items.push({ from: to - closeLen, to, deco: Decoration.replace({}) });
        }
      }

      // 行内代码 `text`：背景（反引号由 CodeMark 子节点隐藏）
      else if (name === "InlineCode") {
        items.push({ from, to, deco: Decoration.mark({ class: "md-inline-code" }) });
      }

      // 链接 [text](url)：整段替换为链接 span（点击由编辑器 click 处理器打开）。
      // 不能拆分隐藏标记：行首/文档开头的单字符 replace 在 CM 渲染中退化为插入
      // 空 widget 而不跳过文本（[ 残留），整段 widget 替换最可靠（与图片一致）
      else if (name === "Link") {
        const text = doc.sliceString(from, to);
        const m = /^\[([\s\S]*?)\]\((.*?)\)$/.exec(text);
        if (m) {
          items.push({ from, to, deco: Decoration.replace({ widget: new LinkWidget(m[1], m[2]) }) });
        }
      }

      // 图片 ![alt](url)：整段替换为 <img>（加载失败显示 [alt] 提示，见 widgets.ts ImageWidget）
      else if (name === "Image") {
        const text = doc.sliceString(from, to);
        const m = /^!\[([\s\S]*?)\]\((.*?)\)$/.exec(text);
        if (m) {
          items.push({ from, to, deco: Decoration.replace({ widget: new ImageWidget(m[2], m[1]) }) });
        }
      }
    };

    // 关键性能优化：只遍历可见范围（viewport），大文档不扫描全文
    for (const range of view.visibleRanges) {
      tree.iterate({ from: range.from, to: range.to, enter: process });
    }

    // 光标所在行指示（非标题/非表格行：源码行加淡底色，提示此处为原始 Markdown；
    // 标题行有级别提示、表格行保持渲染，均不加底色）
    if (
      cursorLine > 0 &&
      cursorLine <= doc.lines &&
      !headingLines.has(cursorLine) &&
      !tableLines.has(cursorLine)
    ) {
      const line = doc.line(cursorLine);
      items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "md-cursor-source" }) });
    }

    // 关键修复：统一按 (from, startSide) 升序排序后添加
    items.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);
    const builder = new RangeSetBuilder<Decoration>();
    for (const it of items) {
      builder.add(it.from, it.to, it.deco);
    }
    return builder.finish();
  } catch (e) {
    console.error("[md-editor WYSIWYG] decorations build failed:", e);
    return Decoration.none;
  }
}
