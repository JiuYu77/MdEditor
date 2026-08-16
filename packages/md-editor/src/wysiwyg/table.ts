/**
 * 表格渲染与操作（@mdeditor/md-editor 内部，独立文件，参考 codeBlock.ts）
 * 参考 Obsidian / Typora / 飞书文档：
 * - 光标在表格内时表格保持渲染（不显示源码），表头左侧显示「表格操作」工具条
 * - 操作（更多菜单）：插入行（上/下）、插入列（左/右）、删除行/列、复制表格、删除表格
 * - 列对齐：工具条快捷按钮（左/中/右），跟随分隔行冒号（:--- 左 / :---: 中 / ---: 右 / --- 左）
 * - 列宽按整表最宽单元格计算（min-width + inline-block 对齐竖线）
 */
import { Decoration, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { EditorState, Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { climbTo, nodeEndLine } from "./tree";
import { copyToClipboard } from "./clipboard";
import { openPopup } from "./popup";

/** 单元格左右内边距之和（px，与 CSS .md-table-cell padding 16px*2 一致） */
const CELL_PADDING = 32;
/** 测量缓冲（px）：兜底渲染差异；DOM 测量已与渲染一致，仅需极小余量 */
const MEASURE_BUFFER = 2;

/** 隐藏测量元素（DOM 渲染测量：与最终渲染同字体、同 white-space，消除 canvas 测量误差） */
let measureSpan: HTMLSpanElement | null = null;
function measureTextWidth(text: string, font: string): number {
  if (!measureSpan) {
    measureSpan = document.createElement("span");
    measureSpan.style.position = "absolute";
    measureSpan.style.visibility = "hidden";
    measureSpan.style.pointerEvents = "none";
    measureSpan.style.whiteSpace = "pre"; // 保留空格（与 .md-table-cell 的 pre-wrap 一致）
    document.body.appendChild(measureSpan);
  }
  measureSpan.style.font = font;
  measureSpan.textContent = text;
  return measureSpan.getBoundingClientRect().width;
}

/** 管道符：完全移除（不占位）——隐藏会因表头加粗导致管道宽度不同、列间隙不一致；
 *  atomic 使光标不可进入/不可直接删除管道（渲染模式下防破坏表格结构，
 *  保存时另有 normalizeTables 兜底修复，见应用层） */
const removePipe = Decoration.replace({ atomic: true });

/** 单元格首尾空格：渲染时同样隐藏（Typora 式——首尾空格只是源码里的对齐/分隔符，
 *  不显示、0 宽，单元格内容贴边）；文档内容不变，保存时原样保留。
 *  用 mark + font-size:0 而非 replace 移除：空格仍在 DOM（0 宽），光标可停在空格上、
 *  输入插到空格之前（末尾输入得到"山东!"而非"山东 !"），且 CM 的 DOM↔state 选择
 *  同步不会把光标漂移到管道位置（replace 移除会漂移） */
const hideCellSpace = Decoration.replace({});

interface RowInfo {
  line: number;
  kind: "header" | "data";
  /** 单元格区间（含末尾管道，使原子管道的占位元素位于单元格 span 内部，
   *  光标停在单元格末尾/管道位置时才能在单元格文本内锚定，而不是落在行级边框上） */
  cells: { from: number; to: number; pipe?: { from: number; to: number } }[];
}

interface DecorationItem {
  from: number;
  to: number;
  deco: Decoration;
}

/** 解析分隔行的列对齐（GFM：:--- 左 / :---: 中 / ---: 右 / --- 左） */
function parseAlignments(doc: Text, delimiterLine: number): ("l" | "c" | "r")[] {
  if (delimiterLine < 0) return [];
  const segs = doc.line(delimiterLine).text.split("|");
  const out: ("l" | "c" | "r")[] = [];
  for (const s of segs.slice(1, -1)) {
    const t = s.trim();
    if (t.startsWith(":") && t.endsWith(":")) out.push("c");
    else if (t.endsWith(":")) out.push("r");
    else out.push("l");
  }
  return out;
}

interface CellRange {
  from: number;
  to: number;
  /** 单元格末尾覆盖的管道（原子移除；无则说明行尾无管道，单元格直接延伸到行尾） */
  pipe?: { from: number; to: number };
}

/**
 * 按管道切分一行表格文本为单元格（GFM：行首/行尾管道均可省略）。
 * 单元格区间含两端空格（使隐藏管道后竖线不错位）；中间的单元格覆盖其末尾管道
 * （原子管道占位位于单元格 span 内，光标停在单元格末尾时锚定在单元格文本中）。
 */
function splitRowCells(lineText: string, lineFrom: number): CellRange[] {
  const cells: CellRange[] = [];
  const pipes: number[] = [];
  for (let i = 0; i < lineText.length; i++) if (lineText[i] === "|") pipes.push(i);
  if (pipes.length === 0) return cells;
  const abs = (p: number) => lineFrom + p;
  // 行首无管道 → 首段是单元格
  if (pipes[0] > 0) cells.push({ from: abs(0), to: abs(pipes[0]) });
  // 管道之间的段（覆盖末尾管道）
  for (let i = 0; i < pipes.length - 1; i++) {
    cells.push({
      from: abs(pipes[i] + 1),
      to: abs(pipes[i + 1] + 1),
      pipe: { from: abs(pipes[i + 1]), to: abs(pipes[i + 1] + 1) },
    });
  }
  // 行尾无管道 → 末段是单元格
  if (pipes[pipes.length - 1] + 1 < lineText.length) {
    cells.push({ from: abs(pipes[pipes.length - 1] + 1), to: abs(lineText.length) });
  }
  return cells;
}

/**
 * 构建整个表格的装饰（行背景/斑马纹/分隔线/列对齐/单元格 min-width/
 * 光标在表内时的操作工具条）。由 decorations.ts 的 Table 分支调用。
 */
export function buildTableDecorations(
  view: EditorView,
  doc: Text,
  tableFrom: number,
  tableTo: number,
  items: DecorationItem[],
): void {
  const tree = syntaxTree(view.state);
  const rows: RowInfo[] = [];
  const pipes: { from: number; to: number }[] = [];
  let delimiterLine = -1;

  // 第一遍：收集全部管道位置与分隔行（前序遍历下 TableHeader/TableRow 先于其子
  // TableDelimiter 出现，故 cells 需在管道收集完成后切分）
  tree.iterate({
    from: tableFrom,
    to: tableTo,
    enter: (node) => {
      if (node.name === "TableHeader" || node.name === "TableRow") {
        rows.push({ line: doc.lineAt(node.from).number, kind: node.name === "TableHeader" ? "header" : "data", cells: [] });
      } else if (node.name === "TableDelimiter") {
        const line = doc.lineAt(node.from);
        if (line.from === node.from && line.to === node.to) delimiterLine = line.number;
        else pipes.push({ from: node.from, to: node.to });
      }
    },
  });

  // 单元格区间 = 按管道切分（含两端空格，并覆盖末尾的管道）：
  // - 覆盖末尾管道：管道以原子 replace 移除，若单元格 mark 不含管道，光标停在管道
  //   位置（=单元格末尾）时 DOM 锚点落在行级 DIV 上，浏览器把光标画在行盒末端 =
  //   单元格右边框上；mark 覆盖管道后，原子占位元素位于单元格 span 内部，
  //   光标锚定在单元格文本内。
  // - 兼容 GFM 省略行首/行尾管道的行（splitRowCells），避免丢失最后一个单元格
  //   导致该行渲染错位、列对齐类不生效。
  // 注意：lezer 的 TableCell 节点不含两端空格，若用它做 mark 区间，
  // 管道移除后残留的空格会成为裸文本占位（约 4px），导致竖线错位。
  for (const row of rows) {
    const line = doc.line(row.line);
    row.cells = splitRowCells(line.text, line.from);
  }

  // 管道移除
  for (const p of pipes) items.push({ from: p.from, to: p.to, deco: removePipe });

  // 列宽：整表每列最宽内容 + 内边距 + 缓冲（作为 flex-basis，页面不足时由 CSS
  // flex-shrink 自动等比收缩、每列最小 48px，内容超宽在单元格内换行——
  // 不在此做 JS 压缩，避免"布局未稳定/滚动条出现后容器宽度变化"导致的时序误差）
  let cellCount = 0;
  for (const r of rows) cellCount += r.cells.length;
  const font = getComputedStyle(view.contentDOM).font || "14px system-ui";
  const colWidths: number[] = [];
  if (cellCount <= 400) {
    for (const row of rows) {
      row.cells.forEach((c, i) => {
        // 单元格覆盖了末尾管道，测量宽度时排除管道字符；首尾空格渲染时隐藏，
        // 故按 trim 后的内容测量（与渲染一致，列宽不虚宽）
        const content = c.pipe
          ? (doc.sliceString(c.from, c.pipe.from) + doc.sliceString(c.pipe.to, c.to)).trim()
          : doc.sliceString(c.from, c.to).trim();
        const w = measureTextWidth(content, font);
        if (w > (colWidths[i] ?? 0)) colWidths[i] = w;
      });
    }
  }
  const baseWidths = colWidths.map((w) => w + CELL_PADDING + MEASURE_BUFFER);

  // 列对齐（分隔行冒号）
  const alignments = parseAlignments(doc, delimiterLine);

  // 行装饰：表头底 + 数据行斑马纹
  let dataIndex = 0;
  for (const row of rows) {
    const cls = row.kind === "header" ? "md-table-header" : "md-table-row" + (dataIndex++ % 2 === 1 ? " md-table-row-stripe" : "");
    const ls = doc.line(row.line).from;
    items.push({ from: ls, to: ls, deco: Decoration.line({ class: cls }) });
  }
  if (delimiterLine >= 0) {
    const ls = doc.line(delimiterLine).from;
    items.push({ from: ls, to: ls, deco: Decoration.line({ class: "md-table-divider" }) });
  }

  // 单元格：对齐列宽（flex-basis）+ 列对齐类 + 内部竖线；表头单元格加粗
  // - 区间含末尾管道（原子移除）：管道占位在 span 内，光标在单元格末尾时
  //   锚定在单元格文本中，不会画到右边框上
  // - width 固定为列宽（flex-basis）：页面不足时 flex 等比收缩、内容在单元格内换行
  // - inclusive: 输入的内容（如空格）延续进单元格，避免光标落在单元格外/边框上
  // - 最外两侧无竖线：首列不加 md-table-cell-brd（无左边框），末列无右边框
  // - 首尾空格隐藏（hideCellSpace，原子）：渲染不显示左右空格（Typora 式），
  //   文档内容不变、保存原样保留；列宽按 trim 后内容测量（见上）
  for (const row of rows) {
    row.cells.forEach((c, i) => {
      const w = baseWidths.length ? (baseWidths[i] ?? 0) : 0;
      let cls = "md-table-cell";
      if (row.kind === "header") cls += " md-table-header-cell";
      cls += " md-table-align-" + (alignments[i] ?? "l");
      if (i > 0) cls += " md-table-cell-brd";
      if (i === row.cells.length - 1) cls += " md-table-cell-last";
      items.push({
        from: c.from,
        to: c.to,
        deco: Decoration.mark({
          class: cls,
          inclusive: true,
          ...(w > 0
            ? {
                attributes: {
                  style: `width:${Math.round(w)}px`,
                  // 供点击夹取：单元格范围与"末尾光标最大位置"（隐藏管道之前），
                  // 点击单元格空白处被映射到下一格时夹回本格末尾
                  "data-from": String(c.from),
                  "data-pipe-from": String(c.pipe ? c.pipe.from : c.to),
                },
              }
            : {}),
        }),
      });
      // 隐藏单元格内容的首尾空格（内容区 = 单元格起点..管道前；无管道则到行尾）
      const contentStart = c.from;
      const contentEnd = c.pipe ? c.pipe.from : c.to;
      const cellText = doc.sliceString(contentStart, contentEnd);
      const lead = /^ */.exec(cellText)?.[0].length ?? 0;
      const trail = / *$/.exec(cellText)?.[0].length ?? 0;
      if (lead > 0) items.push({ from: contentStart, to: contentStart + lead, deco: hideCellSpace });
      if (trail > 0 && contentEnd - trail > contentStart + lead) {
        items.push({ from: contentEnd - trail, to: contentEnd, deco: hideCellSpace });
      }
      // 文本 mark：使文本成为 flex 中可设置的元素 item（flex:1 撑满单元格，
      // 否则 flex 内"最后字符之后"位置的 coordsAtPos 回退到单元格右缘）
      if (contentEnd - lead - trail > contentStart + lead) {
        items.push({
          from: contentStart + lead,
          to: contentEnd - trail,
          deco: Decoration.mark({ class: "md-cell-text", inclusive: true }),
        });
      }
    });
  }
}

/* ─────────────────────────── 表格操作工具条 ─────────────────────────── */

/** 表格信息（操作时从当前文档解析，避免使用过期装饰数据） */
interface TableInfo {
  firstLine: number;
  lastLine: number;
  headerLine: number;
  delimiterLine: number;
  dataLines: number[];
  colCount: number;
  cursorRow: number;
  cursorCol: number;
}

/** 按位置向上查找 Table 节点并解析表格结构 */
function findTableAt(view: EditorView, pos: number): TableInfo | null {
  const tree = syntaxTree(view.state);
  const doc = view.state.doc;
  const node = climbTo(tree, pos, "Table");
  if (!node) return null;
  const from = node.from;
  const to = node.to;
  const firstLine = doc.lineAt(from).number;
  const lastLine = nodeEndLine(doc, from, to);
  const headerLine = firstLine;
  let delimiterLine = -1;
  const dataLines: number[] = [];
  let colCount = 0;
  for (let ln = firstLine; ln <= lastLine; ln++) {
    const text = doc.line(ln).text;
    if (ln === firstLine) {
      colCount = splitRowCells(text, 0).length;
    } else if (/^\|?\s*:?-{2,}:?\s*(\|.*)*$/.test(text)) {
      delimiterLine = ln;
    } else {
      dataLines.push(ln);
    }
  }
  if (colCount < 1) return null;
  // 光标所在行/列（行首无管道时管道数少 1，列号 = 光标前管道数 - (行以管道开头 ? 1 : 0)）
  const cursorLineNum = doc.lineAt(pos).number;
  const cursorRow = cursorLineNum >= firstLine && cursorLineNum <= lastLine ? cursorLineNum : headerLine;
  const cursorLine = doc.line(cursorRow);
  const rowText = cursorLine.text;
  const before = rowText.slice(0, pos - cursorLine.from);
  const pipesBefore = (before.match(/\|/g) ?? []).length;
  const leading = rowText.startsWith("|") ? 1 : 0;
  const cursorCol = Math.max(0, Math.min(pipesBefore - leading, colCount - 1));
  return { firstLine, lastLine, headerLine, delimiterLine, dataLines, colCount, cursorRow, cursorCol };
}

/** 构造一行表格文本（colCount 个空格单元格） */
function buildRowText(colCount: number): string {
  return "|" + Array(colCount).fill("  ").join("|") + "|";
}

/** 在指定行后插入一行 */
function insertRow(view: EditorView, table: TableInfo, afterLine: number): void {
  const doc = view.state.doc;
  const rowText = buildRowText(table.colCount);
  const line = doc.line(afterLine);
  view.dispatch({
    changes: { from: line.to + 1, insert: rowText + "\n" },
    userEvent: "input",
  });
}

/** 删除指定行（数据行） */
function deleteRow(view: EditorView, line: number): void {
  const doc = view.state.doc;
  const l = doc.line(line);
  view.dispatch({
    changes: { from: l.from, to: l.to + 1, insert: "" },
    userEvent: "input",
  });
}

/** 在指定列（左/右）插入或删除一列：所有行 + 分隔行对应位置增删单元格 */
function mutateColumn(view: EditorView, table: TableInfo, colIdx: number, insert: boolean, right = false): void {
  const doc = view.state.doc;
  const lines = [table.headerLine, ...(table.delimiterLine >= 0 ? [table.delimiterLine] : []), ...table.dataLines];
  const changes = lines.map((ln) => {
    const text = doc.line(ln).text;
    const segs = text.split("|");
    if (insert) {
      segs.splice(colIdx + 1 + (right ? 1 : 0), 0, ln === table.delimiterLine ? " --- " : "  ");
    } else {
      segs.splice(colIdx + 1, 1);
    }
    return { from: doc.line(ln).from, to: doc.line(ln).to, insert: segs.join("|") };
  });
  view.dispatch({ changes, userEvent: "input" });
}

/** 复制表格（原始 Markdown）到剪贴板 */
function copyTable(view: EditorView, table: TableInfo): void {
  const doc = view.state.doc;
  const first = doc.line(table.firstLine).from;
  const last = doc.line(table.lastLine).to;
  copyToClipboard(doc.sliceString(first, last));
}

/** 删除整个表格 */
function deleteTable(view: EditorView, table: TableInfo): void {
  const doc = view.state.doc;
  const first = doc.line(table.firstLine).from;
  const last = doc.line(table.lastLine);
  view.dispatch({
    changes: { from: first, to: last.to + 1, insert: "" },
    userEvent: "input",
  });
}

/** 设置指定列对齐（改分隔行冒号；保留横线数量） */
function setColumnAlign(view: EditorView, table: TableInfo, colIdx: number, align: "l" | "c" | "r"): void {
  if (table.delimiterLine < 0) return;
  const doc = view.state.doc;
  const text = doc.line(table.delimiterLine).text;
  const segs = text.split("|");
  const cell = segs[colIdx + 1];
  const dashMatch = /:?-{2,}:?/.exec(cell.trim());
  const dashes = dashMatch ? dashMatch[0].replace(/:/g, "") : "---";
  const cellText = align === "c" ? `:${dashes}:` : align === "r" ? `${dashes}:` : `:${dashes}`;
  segs[colIdx + 1] = ` ${cellText} `;
  view.dispatch({
    changes: { from: doc.line(table.delimiterLine).from, to: doc.line(table.delimiterLine).to, insert: segs.join("|") },
    userEvent: "input",
  });
}

/**
 * 表格操作工具条 ViewPlugin（参考 Typora）：光标在表格内时悬浮于表格首行上方。
 * - 对齐快捷按钮：列左对齐 / 居中 / 右对齐（点击直接作用于光标所在列，无需进菜单）
 * - 更多操作（▸）：插行/列、删除行/列、复制、删除表格等（原菜单）
 * 工具条绝对定位（不占文档流、不改变表格渲染样式），滚动时跟随表格。
 * 定位用 view.requestMeasure + scroll 监听（measure 阶段执行布局查询）。
 */
export const tableToolbarPlugin = ViewPlugin.fromClass(
  class TableToolbarPlugin {
    bar: HTMLDivElement;
    alignBtns: { btn: HTMLButtonElement; align: "l" | "c" | "r" }[] = [];
    line = -1; // 当前光标所在行
    constructor(view: EditorView) {
      this.bar = document.createElement("div");
      this.bar.className = "md-table-toolbar";
      this.bar.style.display = "none";
      // 对齐快捷按钮
      const mkAlign = (align: "l" | "c" | "r", icon: string, title: string) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "md-table-toolbar-btn";
        btn.title = title;
        btn.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>`;
        btn.onclick = (e) => {
          e.stopPropagation();
          const table = findTableAt(view, view.state.selection.main.head);
          if (table) setColumnAlign(view, table, table.cursorCol, align);
        };
        this.alignBtns.push({ btn, align });
        this.bar.appendChild(btn);
      };
      mkAlign("l", "fa-align-left", "列左对齐");
      mkAlign("c", "fa-align-center", "列居中");
      mkAlign("r", "fa-align-right", "列右对齐");
      const sep = document.createElement("span");
      sep.className = "md-table-toolbar-sep";
      this.bar.appendChild(sep);
      // 更多操作（原表格菜单）
      const more = document.createElement("button");
      more.type = "button";
      more.className = "md-table-toolbar-btn";
      more.title = "更多表格操作";
      more.innerHTML = '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
      more.onclick = (e) => {
        e.stopPropagation();
        openTableMenu(view, more);
      };
      this.bar.appendChild(more);
      view.dom.appendChild(this.bar);
      this.line = view.state.doc.lineAt(view.state.selection.main.head).number;
      // 滚动时直接重新定位（不依赖 CM update 触发，滚动即跟随）
      view.scrollDOM.addEventListener("scroll", () => this.schedule(view));
    }
    /** 延后到 CM measure 阶段定位（read 只读布局、write 写 DOM） */
    schedule(view: EditorView): void {
      view.requestMeasure({
        key: this,
        read: () => {
          const tableStart = tableStartAtLine(view.state, this.line);
          return tableStart == null ? null : view.coordsAtPos(tableStart);
        },
        write: (coords) => {
          if (!coords) {
            this.bar.style.display = "none";
            return;
          }
          const hostRect = view.dom.getBoundingClientRect();
          this.bar.style.display = "flex";
          this.bar.style.left = `${Math.round(coords.left - hostRect.left)}px`;
          this.bar.style.top = `${Math.round(coords.top - hostRect.top - 32)}px`;
        },
      });
    }
    /** 更新对齐按钮激活态（当前列的对齐高亮） */
    updateAligned(view: EditorView): void {
      const table = findTableAt(view, view.state.selection.main.head);
      const aligns = table && table.delimiterLine >= 0 ? parseAlignments(view.state.doc, table.delimiterLine) : [];
      const active = table ? aligns[table.cursorCol] : undefined;
      for (const { btn, align } of this.alignBtns) {
        btn.classList.toggle("active", align === active);
      }
    }
    update(update: ViewUpdate) {
      this.line = update.state.doc.lineAt(update.state.selection.main.head).number;
      this.schedule(update.view);
      this.updateAligned(update.view);
    }
    destroy() {
      this.bar.remove();
    }
  },
);

/** 返回光标所在行的表格起始位置（不在表格内返回 null） */
function tableStartAtLine(state: EditorState, line: number): number | null {
  const doc = state.doc;
  const node = climbTo(syntaxTree(state), doc.line(line).from, "Table");
  return node ? node.from : null;
}

/** 当前打开的表格菜单关闭函数（打开新菜单前先关闭旧的，避免菜单叠加/过期引用） */
let currentTableMenuClose: (() => void) | null = null;

/** 表格操作弹层（挂在 body，复用 openPopup 脚手架） */
function openTableMenu(view: EditorView, anchor: HTMLElement): void {
  if (currentTableMenuClose) currentTableMenuClose();
  const { popup, close: baseClose } = openPopup(anchor, "md-table-menu");
  const close = () => {
    baseClose();
    if (currentTableMenuClose === close) currentTableMenuClose = null;
  };
  currentTableMenuClose = close;

  // 解析当前光标所在表格（用真实光标位置而非按钮位置——
  // 按钮在表头行首，用它定位会把光标行/列算到表头行）
  const table = findTableAt(view, view.state.selection.main.head);

  const addItem = (label: string, run: () => void, disabled = false) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "md-table-menu-item";
    item.textContent = label;
    item.disabled = disabled;
    item.onclick = (e) => {
      e.stopPropagation();
      close();
      run();
    };
    popup.appendChild(item);
  };
  const addSep = () => {
    const sep = document.createElement("div");
    sep.className = "md-table-menu-sep";
    popup.appendChild(sep);
  };

  if (!table) {
    addItem("未定位到表格", () => {}, true);
  } else {
    addItem("在上方插入行", () => insertRow(view, table, table.cursorRow === table.firstLine ? table.cursorRow : table.cursorRow - 1), table.cursorRow === table.firstLine);
    addItem("在下方插入行", () => insertRow(view, table, table.cursorRow));
    addItem("在左侧插入列", () => mutateColumn(view, table, table.cursorCol, true, false));
    addItem("在右侧插入列", () => mutateColumn(view, table, table.cursorCol, true, true));
    addSep();
    addItem("删除当前行", () => deleteRow(view, table.cursorRow), table.cursorRow === table.headerLine || table.cursorRow === table.delimiterLine || table.dataLines.length <= 1);
    addItem("删除当前列", () => mutateColumn(view, table, table.cursorCol, false), table.colCount <= 1);
    addItem("复制表格", () => copyTable(view, table));
    addItem("删除表格", () => deleteTable(view, table));
  }
}

/* ─────────────────────────── 单元格点击定位 ─────────────────────────── */

/** 单元格内一个可见字符的几何与文档位置 */
interface CellChar {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** 该字符的文档位置（光标停在字符前 = 此位置） */
  pos: number;
}

/**
 * 收集单元格内可见字符的几何（排除隐藏空格 .md-hide-cell-space、管道占位等
 * 0 宽元素）。点击定位用逐字符几何，确定性：不依赖 CM6 posAtCoords（其对 flex
 * 单元格内换行文本定位不准：点击第二行会映射到首行开头）。
 */
function collectCellChars(cell: HTMLElement, view: EditorView): CellChar[] {
  const chars: CellChar[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node.textContent ?? "";
      const parent = node.parentElement as HTMLElement | null;
      if (!text || !parent || parent.classList.contains("md-hide-cell-space")) return;
      let docFrom = 0;
      try {
        docFrom = view.posAtDOM(node, 0);
      } catch {
        return;
      }
      for (let i = 0; i < text.length; i++) {
        const rng = document.createRange();
        rng.setStart(node, i);
        rng.setEnd(node, i + 1);
        const r = rng.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          chars.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, pos: docFrom + i });
        }
      }
      return;
    }
    node.childNodes.forEach(visit);
  };
  visit(cell);
  return chars;
}

/** 按点击 y 找出所在行（或最近行）的字符（同行字符 top 相同） */
function charsInLine(chars: CellChar[], y: number): CellChar[] {
  const hit = chars.filter((c) => c.top <= y && y <= c.bottom);
  const anchor = hit.length > 0 ? hit[0] : chars.reduce((a, b) => (Math.abs(b.top - y) < Math.abs(a.top - y) ? b : a));
  return chars.filter((c) => Math.abs(c.top - anchor.top) < 1);
}

/**
 * 表格单元格点击的目标光标位置（确定性，供宿主 click 处理器调用）：
 * - 点击该行文字左侧（不论远近）→ 行首
 * - 点击该行文字右侧（不论远近）→ 行末
 * - 点击文字上 → 最近字符
 * 结果夹在单元格范围内（data-from..data-pipe-from，见单元格 mark 的 data 属性）。
 */
export function tableCellTargetPos(view: EditorView, cell: HTMLElement, x: number, y: number): number {
  const from = Number(cell.dataset.from ?? 0);
  const pipeFrom = Number(cell.dataset.pipeFrom ?? 0);
  let target = from;
  try {
    const chars = collectCellChars(cell, view);
    if (chars.length > 0) {
      const line = charsInLine(chars, y);
      let minLeft = Infinity;
      let maxRight = -Infinity;
      for (const c of line) {
        if (c.left < minLeft) minLeft = c.left;
        if (c.right > maxRight) maxRight = c.right;
      }
      if (x < minLeft) {
        target = Math.min(...line.map((c) => c.pos));
      } else if (x > maxRight) {
        target = Math.max(...line.map((c) => c.pos)) + 1;
      } else {
        let nearest = line[0];
        for (const c of line) {
          if (Math.abs(x - (c.left + c.right) / 2) < Math.abs(x - (nearest.left + nearest.right) / 2)) {
            nearest = c;
          }
        }
        target = Math.abs(x - nearest.left) < Math.abs(x - nearest.right) ? nearest.pos : nearest.pos + 1;
      }
    }
  } catch {
    target = from;
  }
  return Math.min(Math.max(target, from), pipeFrom);
}
