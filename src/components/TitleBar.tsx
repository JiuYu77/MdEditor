import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TitleBarProps {
  /** 当前打开的文档名（无文件时为 null） */
  documentName: string | null;
}

/**
 * 自绘标题栏（需求文档 §3.4.3 样式 B / 样式 C）
 * - 拖拽：data-tauri-drag-region；双击标题区最大化
 * - 窗口控制按钮：自绘 SVG，吃主题 CSS 变量
 * - TODO(macOS): 无边框下预留 Traffic Light 空间（FW-06）
 */
export function TitleBar({ documentName }: TitleBarProps) {
  const { t } = useTranslation();
  const appWindow = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    appWindow
      .onResized(() => appWindow.isMaximized().then(setMaximized))
      .then((fn) => (unlisten = fn))
      .catch(console.error);
    appWindow.isMaximized().then(setMaximized).catch(console.error);
    return () => {
      unlisten?.();
    };
  }, [appWindow]);

  return (
    <header className="titlebar" data-tauri-drag-region onDoubleClick={() => appWindow.toggleMaximize()}>
      <div className="titlebar-title" data-tauri-drag-region>
        <img className="titlebar-icon" src="/icon.png" alt="" width="16" height="16" draggable={false} />
        <span className="titlebar-app">MdEditor</span>
        {documentName && (
          <span className="titlebar-doc" data-tauri-drag-region>
            {documentName}
          </span>
        )}
      </div>
      <div className="titlebar-controls">
        <button
          className="tb-btn"
          title={t("titlebar.minimize")}
          onClick={() => appWindow.minimize()}
          aria-label={t("titlebar.minimize")}
        >
          <svg viewBox="0 0 12 12" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" aria-hidden="true">
            <path d="M2 6h8" />
          </svg>
        </button>
        <button
          className="tb-btn"
          title={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
          onClick={() => appWindow.toggleMaximize()}
          aria-label={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
        >
          {maximized ? (
            <svg viewBox="0 0 12 12" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="1.5" y="3.5" width="7" height="7" />
              <path d="M3.5 1.5h7v7" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" aria-hidden="true">
              <rect x="2.5" y="2.5" width="7" height="7" />
            </svg>
          )}
        </button>
        <button
          className="tb-btn tb-close"
          title={t("titlebar.close")}
          onClick={() => appWindow.close()}
          aria-label={t("titlebar.close")}
        >
          <svg viewBox="0 0 12 12" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      </div>
    </header>
  );
}
