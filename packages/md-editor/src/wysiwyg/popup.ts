/**
 * 悬浮弹层工具（@mdeditor/md-editor 内部）
 * 供表格操作菜单（table.ts openTableMenu）与代码块语言选择（codeBlock.ts
 * openLangPicker）共用：定位到锚点下方、点击外部关闭、挂在 body。
 */

/** 创建悬浮弹层：返回容器与关闭函数（关闭 = 移除监听 + 移除 DOM） */
export function openPopup(
  anchor: HTMLElement,
  className: string,
): { popup: HTMLDivElement; close: () => void } {
  const close = () => {
    document.removeEventListener("mousedown", onDocDown, true);
    popup.remove();
  };
  const onDocDown = (ev: MouseEvent) => {
    if (!popup.contains(ev.target as Node)) close();
  };
  const rect = anchor.getBoundingClientRect();
  const popup = document.createElement("div");
  popup.className = className;
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${rect.bottom + 4}px`;
  document.addEventListener("mousedown", onDocDown, true);
  document.body.appendChild(popup);
  return { popup, close };
}
