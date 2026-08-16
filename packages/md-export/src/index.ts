/**
 * @mdeditor/md-export —— 导出库（HTML / PDF / 图片）
 *
 * 依赖 @mdeditor/md-core 做渲染，导出时内嵌主题 CSS（来自主题包）。
 */

/** 导出选项 */
export interface ExportOptions {
  /** 主题 CSS（导出时内嵌，保持主题样式） */
  themeCss?: string;
  /** 是否内嵌图片（base64），默认 true */
  inlineImages?: boolean;
}

/**
 * 导出 HTML（单文件，内嵌样式与图片）
 * TODO: 基于 md-core 渲染 + 主题 CSS 组装
 */
export function exportHtml(md: string, options: ExportOptions = {}): string {
  void md;
  void options;
  throw new Error('md-export 尚未实现：骨架占位');
}

/** 导出 PDF（保留主题样式）TODO */
export function exportPdf(md: string, options: ExportOptions = {}): Promise<Blob> {
  void md;
  void options;
  throw new Error('md-export 尚未实现：骨架占位');
}

/** 导出图片（整页/选区截图）TODO */
export function exportImage(): Promise<Blob> {
  throw new Error('md-export 尚未实现：骨架占位');
}
