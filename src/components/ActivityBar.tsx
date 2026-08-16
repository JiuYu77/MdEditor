import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

/** 侧边栏面板标识 */
export type PanelId = "explorer" | "search" | "outline" | "extensions" | "settings";

/** Font Awesome 图标（跟随 currentColor，随主题变色） */
const ICONS: Record<PanelId, ReactNode> = {
  explorer: <i className="fa-solid fa-folder" />,
  search: <i className="fa-solid fa-magnifying-glass" />,
  outline: <i className="fa-solid fa-list-ul" />,
  extensions: <i className="fa-solid fa-puzzle-piece" />,
  settings: <i className="fa-solid fa-gear" />,
};

const PANEL_KEYS: Record<PanelId, string> = {
  explorer: "activity.explorer",
  search: "activity.search",
  outline: "activity.outline",
  extensions: "activity.extensions",
  settings: "activity.settings",
};

interface ActivityBarProps {
  active: PanelId | null;
  onToggle: (id: PanelId) => void;
}

/** 活动栏（最左侧竖条，对标 VS Code；设置图标固定底部） */
export function ActivityBar({ active, onToggle }: ActivityBarProps) {
  const { t } = useTranslation();

  const renderItem = (id: PanelId, className = "activity-item") => (
    <button
      key={id}
      className={className + (active === id ? " active" : "")}
      title={t(PANEL_KEYS[id])}
      onClick={() => onToggle(id)}
    >
      {ICONS[id]}
    </button>
  );

  return (
    <nav className="activity-bar">
      {(Object.keys(ICONS) as PanelId[])
        .filter((id) => id !== "settings")
        .map((id) => renderItem(id))}
      {renderItem("settings", "activity-item activity-settings")}
    </nav>
  );
}
