/** 路径工具（应用层统一，消除组件间重复的 basename 实现） */

/** 文件名（含路径时取最后一段） */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
