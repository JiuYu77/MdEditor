/**
 * 表格规范化（保存前兜底，见需求「保证保存到文件中的表格代码正确」）。
 *
 * 背景：WYSIWYG（Live Preview）渲染模式下表格管道符 | 被隐藏（Decoration.replace，
 * atomic 防直接删除），但拖选/粘贴/光标落点等仍可能破坏表格结构，典型损坏：
 * - 行首/行尾缺少 |（如 `|  的的 |  |单独的`，行尾管道丢失）
 * - 某行列数与其他行不一致（多/少管道）
 * 损坏的表格原样保存会污染文件，故保存（含另存为）前做保守修复。
 *
 * 原则：只重建「结构损坏」的行；正常行逐字节保留（不改变任何合法表格文本）。
 */

/** 解析一行表格文本为单元格数组（保护转义管道 \|） */
function parseCells(raw: string): string[] {
  const esc = raw.replace(/\\\|/g, "\u0000");
  const parts = esc.split("|");
  // 去掉行首 | 之前的空段；若行尾有 |，去掉其后的空段
  let cells = parts.slice(1);
  if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells.map((s) => s.replace(/\u0000/g, "\\|"));
}

/** 该行是否为分隔行（| --- | 形式，含冒号对齐） */
function isDelimiterLine(raw: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|.*)*$/.test(raw);
}

/** 行是否结构完整：以 | 开头、以 | 结尾、单元格数 = 列数 */
function isWellFormed(raw: string, colCount: number): boolean {
  return /^\s*\|/.test(raw) && /\|\s*$/.test(raw) && parseCells(raw).length === colCount;
}

/** 重建一行：单元格数量对齐到列数（缺补空、多合并进最后一列，不丢内容）；
 *  保留原行行首缩进（GFM 允许 ≤3 空格缩进） */
function rebuildLine(raw: string, cells: string[], colCount: number, delimiter = false): string {
  const c = cells.slice();
  const pad = delimiter ? " --- " : "  ";
  while (c.length < colCount) c.push(pad);
  if (c.length > colCount) {
    // 多余段（如行尾缺 | 混入的文本）拼入最后一列：trim 后以单空格连接，纯空白段折叠
    const extra = c.slice(colCount - 1);
    const joined = extra.map((s) => s.trim()).join(" ");
    c[colCount - 1] = joined || pad.trim() || "  ";
    c.length = colCount;
  }
  const indent = /^\s*/.exec(raw)?.[0] ?? "";
  return indent + "|" + c.join("|") + "|";
}

/** 规范化一个表格块（以 | 开头的连续行）：块首行为表头，决定列数 */
function normalizeTableBlock(block: string[]): string[] {
  const colCount = parseCells(block[0]).length;
  if (colCount < 1) return block; // 表头无法解析 → 不动（保守）
  let delimIdx = -1;
  for (let k = 1; k < block.length; k++) {
    if (isDelimiterLine(block[k])) {
      delimIdx = k;
      break;
    }
  }
  return block.map((raw, idx) => {
    if (isWellFormed(raw, colCount)) return raw;
    return rebuildLine(raw, parseCells(raw), colCount, idx === delimIdx);
  });
}

/**
 * 规范化文档中的全部表格：逐行扫描，收集以 | 开头（允许前导空白）的连续行作为表格块，
 * 块内按表头列数修复损坏行；非表格内容原样保留。
 */
export function normalizeTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^\s*\|/.test(lines[i])) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const block: string[] = [lines[i]];
    let j = i + 1;
    while (j < lines.length && /^\s*\|/.test(lines[j])) {
      block.push(lines[j]);
      j++;
    }
    out.push(...normalizeTableBlock(block));
    i = j;
  }
  return out.join("\n");
}
