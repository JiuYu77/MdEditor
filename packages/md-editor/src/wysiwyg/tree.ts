/**
 * 语法树/文档位置工具（@mdeditor/md-editor 内部）
 * 跨 codeBlock.ts / table.ts / decorations.ts / index.ts 共用的
 * 语法树向上爬升、节点末行、围栏正则。
 */
import type { SyntaxNode } from "@lezer/common";
import type { Text } from "@codemirror/state";
import type { Tree } from "@lezer/common";

/** 开围栏标记（``` 或 ~~~，3+ 个；捕获组为标记本身） */
export const FENCE_OPEN_RE = /^(`{3,}|~{3,})/;
/** 闭围栏标记（允许前后空白） */
export const FENCE_CLOSE_RE = /^\s*(`{3,}|~{3,})\s*$/;

/**
 * 从位置向上爬到指定语法节点类型。
 * 文档/节点边界（行首、文档起点等）处 resolveInner(pos, 0) 可能返回根节点，
 * 回退 side=1 再查。
 */
export function climbTo(tree: Tree, pos: number, name: string): SyntaxNode | null {
  const walk = (n: SyntaxNode | null): SyntaxNode | null => {
    while (n && n.name !== name) n = n.parent;
    return n;
  };
  return walk(tree.resolveInner(pos, 0)) ?? walk(tree.resolveInner(pos, 1));
}

/** 节点末字符所在行号（from..to 至少含一个字符时与 lineAt(to-1) 等价） */
export function nodeEndLine(doc: Text, from: number, to: number): number {
  return doc.lineAt(Math.max(from, to - 1)).number;
}
