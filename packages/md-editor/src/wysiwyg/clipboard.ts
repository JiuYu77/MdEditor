/**
 * 剪贴板工具（@mdeditor/md-editor 内部）
 * 优先异步 Clipboard API，失败回退 execCommand（textarea 复制）。
 * 供代码块复制（codeBlock.ts）与表格复制（table.ts）共用。
 */

/** 复制文本到剪贴板 */
export function copyToClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string): void {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    /* ignore */
  }
}
