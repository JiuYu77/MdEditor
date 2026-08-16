import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fileIconClass } from "../fileIcons";
import { basename } from "../utils/path";

/** 最近打开条目（文件与文件夹统一按时间排序，新→旧；类型定义见 App.tsx） */
interface RecentItem {
  path: string;
  isDir: boolean;
  time: number;
}

interface WelcomePageProps {
  /** 最近打开（新→旧，文件与文件夹统一按时间排序） */
  recent: RecentItem[];
  onNewFile: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenRecent: (path: string, isDir: boolean) => void;
  /** 从历史中移除单条（× 按钮） */
  onRemoveRecent: (path: string) => void;
}

/**
 * 欢迎页（对标 VS Code Welcome：Start 操作区 + Recent 历史记录区）
 * 见需求文档 §5.2 欢迎页设计（Start + Recent 双区块）
 * 最近记录：文件与文件夹混排，按打开时间（新→旧）排序
 */
export function WelcomePage({
  recent,
  onNewFile,
  onOpenFile,
  onOpenFolder,
  onOpenRecent,
  onRemoveRecent,
}: WelcomePageProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const hasRecent = recent.length > 0;
  // 历史条目超过 6 条时，最近区域内部滚动（保持 Start 区可见）
  const recentOverflow = recent.length > 6;

  return (
    <div className="welcome">
      <h1 className="welcome-title">{t("app.name")}</h1>
      <p className="welcome-subtitle">{t("app.tagline")}</p>

      <section className="welcome-section">
        <h2 className="welcome-section-title">{t("welcome.start")}</h2>
        <div className="welcome-actions">
          <button type="button" className="welcome-action" onClick={onNewFile}>
            <i className="fa-solid fa-file-circle-plus" aria-hidden="true" />
            {t("welcome.newFile")}
          </button>
          <button type="button" className="welcome-action" onClick={onOpenFile}>
            <i className="fa-solid fa-file-arrow-up" aria-hidden="true" />
            {t("welcome.openFile")}
          </button>
          <button type="button" className="welcome-action" onClick={onOpenFolder}>
            <i className="fa-solid fa-folder-open" aria-hidden="true" />
            {t("welcome.openFolder")}
          </button>
        </div>
      </section>

      <section className="welcome-section">
        <h2 className="welcome-section-title">{t("welcome.recent")}</h2>
        {!hasRecent ? (
          <p className="welcome-empty">{t("welcome.noRecent")}</p>
        ) : (
          <div
            className={"welcome-recent" + (recentOverflow ? " welcome-recent-scroll" : "") + (hovered ? " hovered" : "")}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <ul className="welcome-recent-list">
              {recent.map((item) => (
                <li key={item.path}>
                  <div className="welcome-recent-row">
                    <button
                      type="button"
                      className="welcome-recent-item"
                      onClick={() => onOpenRecent(item.path, item.isDir)}
                    >
                      <span className="welcome-recent-name">
                        <i
                          className={item.isDir ? "fa-solid fa-folder" : fileIconClass(item.path)}
                          aria-hidden="true"
                        />
                        {basename(item.path)}
                      </span>
                      <span className="welcome-recent-path" title={item.path}>
                        {item.path}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="welcome-recent-remove"
                      title={t("welcome.removeRecent")}
                      aria-label={t("welcome.removeRecent")}
                      onClick={() => onRemoveRecent(item.path)}
                    >
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
