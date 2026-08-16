import { useTranslation } from "react-i18next";

interface StatusBarProps {
  selected: string | null;
  mode: "wysiwyg" | "source";
  /** 当前光标位置（行/列，1-based） */
  cursor: { line: number; col: number } | null;
  /** 当前文档字符数（无文件为 null） */
  charCount: number | null;
  /** 左侧区域（活动栏 + 侧边栏）是否可见 */
  leftBarVisible: boolean;
  /** 状态栏左侧按钮：隐藏/显示 活动栏与侧边栏 */
  onToggleLeftBar: () => void;
  onToggleMode: () => void;
}

/** 状态栏（底部；左侧为左区域显隐按钮，右侧为行/列、模式、字符数、语言、编码） */
export function StatusBar({
  selected,
  mode,
  cursor,
  charCount,
  leftBarVisible,
  onToggleLeftBar,
  onToggleMode,
}: StatusBarProps) {
  const { t } = useTranslation();

  return (
    <footer className="status-bar">
      <span className="status-left">
        <button
          type="button"
          className="status-btn status-toggle-left"
          onClick={onToggleLeftBar}
          title={t("status.toggleLeftBar")}
        >
          <i className={"fa-solid " + (leftBarVisible ? "fa-outdent" : "fa-indent")} aria-hidden="true" />
        </button>
      </span>
      <span className="status-right">
        {selected && cursor && (
          <span className="status-item">
            {t("status.line", { line: cursor.line, column: cursor.col })}
          </span>
        )}
        <button className="status-item status-btn" onClick={onToggleMode} title={t("status.modeTip")}>
          {mode === "wysiwyg" ? t("status.modeWysiwyg") : t("status.modeSource")}
        </button>
        {selected && charCount !== null && (
          <span className="status-item">{t("status.chars", { count: charCount })}</span>
        )}
        <span className="status-item">{t("status.language")}: Markdown</span>
        <span className="status-item">{t("status.encoding")}: UTF-8</span>
      </span>
    </footer>
  );
}
