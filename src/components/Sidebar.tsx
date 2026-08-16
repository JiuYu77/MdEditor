import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileTree } from "./FileTree";
import { SearchPanel } from "./SearchPanel";
import { basename } from "../utils/path";
import type { PanelId } from "./ActivityBar";
import type { OutlineItem } from "@mdeditor/md-editor";

const MIN_WIDTH = 160;
const MAX_WIDTH = 560;

/** 大纲树节点：标题 + 子标题 */
interface OutlineNode {
  item: OutlineItem;
  children: OutlineNode[];
}

/** 节点唯一键（行号 + 位置） */
function nodeKey(item: OutlineItem): string {
  return `${item.line}-${item.pos}`;
}

/** 把扁平大纲（文档顺序）构建为层级树：子标题挂在最近一个更高级标题下 */
function buildOutlineTree(items: OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: { level: number; node: OutlineNode }[] = [];
  for (const item of items) {
    const node: OutlineNode = { item, children: [] };
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ level: item.level, node });
  }
  return roots;
}

interface SidebarProps {
  panel: PanelId;
  rootDir: string;
  selected: string | null;
  onSelect: (path: string) => void;
  useNativeTitleBar: boolean;
  onToggleNativeTitleBar: () => void;
  /** 显示行号（源码模式） */
  showLineNumbersSource: boolean;
  /** 显示行号（所见即所得模式） */
  showLineNumbersWysiwyg: boolean;
  onSetShowLineNumbers: (mode: "source" | "wysiwyg", value: boolean) => void;
  /** 光标所在行显示 Markdown 源码 */
  cursorLineSource: boolean;
  onToggleCursorLineSource: () => void;
  /** 高亮当前行（源码模式） */
  highlightActiveLineSource: boolean;
  /** 高亮当前行（所见即所得模式） */
  highlightActiveLineWysiwyg: boolean;
  onSetHighlightActiveLine: (mode: "source" | "wysiwyg", value: boolean) => void;
  language: string;
  onChangeLanguage: (lang: string) => void;
  /** 启动行为：welcome | lastDir | lastFile */
  startupBehavior: string;
  onStartupBehaviorChange: (value: string) => void;
  /** 初始/受控宽度（来自 settings.sidebarWidth） */
  width: number;
  /** 拖拽结束时回调，用于持久化最终宽度 */
  onWidthChange: (width: number) => void;
  /** 当前文档大纲 */
  outline: OutlineItem[];
  /** 当前光标所在章节（大纲高亮） */
  activeOutlineIndex: number;
  /** 点击大纲条目：跳转到对应标题 */
  onOutlineJump: (pos: number) => void;
  /** 文件树刷新键（新建文件后 +1，强制重新拉取目录） */
  treeRefreshKey: number;
  /** 外部刷新信号（App 轮询/刷新按钮触发：{path, version}，path="*" 刷新全部展开目录） */
  externalReload: { path: string; version: number } | null;
  /** 文件树刷新按钮点击（强制重新拉取当前根目录全部内容） */
  onRefreshTree: () => void;
  /** 打开文件夹（原生目录选择器，空根目录引导/菜单调用） */
  onOpenFolder: () => void;
  /** 条目重命名完成（App 同步选中文件路径） */
  onEntryRenamed: (oldPath: string, newPath: string) => void;
  /** 条目删除完成（App 关闭被删文件） */
  onEntryDeleted: (path: string) => void;
  /** 全局搜索：点击结果打开文件并跳转行 */
  onSearchOpen: (path: string, line: number) => void;
}

const PANEL_KEYS: Record<PanelId, string> = {
  explorer: "activity.explorer",
  search: "activity.search",
  outline: "activity.outline",
  extensions: "activity.extensions",
  settings: "activity.settings",
};

interface OutlineRowProps {
  node: OutlineNode;
  depth: number;
  collapsed: Set<string>;
  activeKey: string | null;
  onToggle: (key: string) => void;
  onJump: (pos: number) => void;
}

/** 大纲树节点行（递归）：▸/▾ 展开折叠，点文字跳转 */
function OutlineRow({ node, depth, collapsed, activeKey, onToggle, onJump }: OutlineRowProps) {
  const key = nodeKey(node.item);
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(key);
  const isActive = activeKey === key;
  return (
    <>
      <button
        type="button"
        className={
          "outline-item" +
          (isActive ? " active" : "") +
          (node.item.level === 1 ? " outline-l1" : node.item.level === 2 ? " outline-l2" : "")
        }
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onJump(node.item.pos)}
        title={node.item.text}
      >
        {hasChildren && (
          <span
            className="outline-caret"
            role="button"
            aria-expanded={!isCollapsed}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(key);
            }}
          >
            <i className={"fa-solid " + (isCollapsed ? "fa-chevron-right" : "fa-chevron-down")} aria-hidden="true" />
          </span>
        )}
        <span className="outline-text">{node.item.text}</span>
      </button>
      {!isCollapsed &&
        hasChildren &&
        node.children.map((child) => (
          <OutlineRow
            key={nodeKey(child.item)}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            activeKey={activeKey}
            onToggle={onToggle}
            onJump={onJump}
          />
        ))}
    </>
  );
}

/** 侧边栏（文件树 / 搜索 / 大纲 / 扩展 / 设置，对标 VS Code，宽度可拖拽） */
export function Sidebar({
  panel,
  rootDir,
  selected,
  onSelect,
  useNativeTitleBar,
  onToggleNativeTitleBar,
  showLineNumbersSource,
  showLineNumbersWysiwyg,
  onSetShowLineNumbers,
  cursorLineSource,
  onToggleCursorLineSource,
  highlightActiveLineSource,
  highlightActiveLineWysiwyg,
  onSetHighlightActiveLine,
  language,
  onChangeLanguage,
  startupBehavior,
  onStartupBehaviorChange,
  width: initialWidth,
  onWidthChange,
  outline,
  activeOutlineIndex,
  onOutlineJump,
  treeRefreshKey,
  externalReload,
  onRefreshTree,
  onOpenFolder,
  onEntryRenamed,
  onEntryDeleted,
  onSearchOpen,
}: SidebarProps) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(initialWidth);
  const [resizing, setResizing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const widthRef = useRef(initialWidth);
  const startXRef = useRef(0);
  const startWidthRef = useRef(initialWidth);

  // ── 大纲树状态 ──
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildOutlineTree(outline), [outline]);
  const activeKey = activeOutlineIndex >= 0 && outline[activeOutlineIndex] ? nodeKey(outline[activeOutlineIndex]) : null;

  // 当前章节变化时自动展开其祖先分支（对标 VS Code 大纲）
  useEffect(() => {
    if (activeOutlineIndex < 0) return;
    const target = outline[activeOutlineIndex];
    let level = target.level;
    const need: string[] = [];
    for (let i = activeOutlineIndex - 1; i >= 0; i--) {
      if (outline[i].level < level) {
        need.push(nodeKey(outline[i]));
        level = outline[i].level;
      }
    }
    if (need.length) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const k of need) {
          if (next.delete(k)) changed = true;
        }
        return changed ? next : prev;
      });
    }
  }, [activeOutlineIndex, outline]);

  const toggleNode = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── 文件树：新建条目状态（头部按钮/右键菜单共用） ──
  const [creating, setCreating] = useState<{ parent: string; kind: "file" | "dir" } | null>(null);
  // 当前选中的目录（头部按钮新建的目标位置；默认根目录）
  const [targetDir, setTargetDir] = useState<string | null>(null);
  useEffect(() => {
    setTargetDir(null);
  }, [rootDir]);

  const updateWidth = (w: number) => {
    widthRef.current = w;
    setWidth(w);
  };

  const onHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = widthRef.current;
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidthRef.current + (e.clientX - startXRef.current)),
      );
      updateWidth(next);
    };
    const onUp = () => {
      setResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onWidthChange(widthRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing, onWidthChange]);

  return (
    <aside className="sidebar" style={{ width }}>
      <header className="sidebar-header">
        <span className="sidebar-title">{t(PANEL_KEYS[panel])}</span>
        {panel === "explorer" && rootDir && (
          <span className="sidebar-actions">
            <button
              type="button"
              className="sidebar-action"
              title={t("filetree.newFile")}
              onClick={() => setCreating({ parent: targetDir || rootDir, kind: "file" })}
            >
              <i className="fa-solid fa-file-circle-plus" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="sidebar-action"
              title={t("filetree.newFolder")}
              onClick={() => setCreating({ parent: targetDir || rootDir, kind: "dir" })}
            >
              <i className="fa-solid fa-folder-plus" aria-hidden="true" />
            </button>
            <button type="button" className="sidebar-action" title={t("filetree.refresh")} onClick={onRefreshTree}>
              <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
            </button>
          </span>
        )}
      </header>

      <div
        className={"sidebar-body" + (hovered ? " hovered" : "")}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {panel === "explorer" &&
          (rootDir ? (
            <>
              <div className="sidebar-path" title={rootDir}>
                {basename(rootDir)}
              </div>
              <FileTree
                key={treeRefreshKey}
                root={rootDir}
                selected={selected}
                onSelect={onSelect}
                onRename={onEntryRenamed}
                onDelete={onEntryDeleted}
                creating={creating}
                onCreatingDone={() => setCreating(null)}
                onCreateIn={(parent, kind) => setCreating({ parent, kind })}
                targetDir={targetDir}
                onTargetDirChange={setTargetDir}
                externalReload={externalReload}
              />
            </>
          ) : (
            <div className="panel-placeholder open-folder-prompt">
              <p className="panel-note">{t("sidebar.openFolderPrompt")}</p>
              <button type="button" className="open-folder-btn" onClick={onOpenFolder}>
                {t("menu.openFolder")}
              </button>
            </div>
          ))}

        {panel === "search" && (
          <SearchPanel rootDir={rootDir} onOpenResult={onSearchOpen} />
        )}

        {panel === "outline" && (
          <div className="outline-panel">
            {tree.length === 0 ? (
              <p className="panel-note">{t("sidebar.outlineEmpty")}</p>
            ) : (
              tree.map((node) => (
                <OutlineRow
                  key={nodeKey(node.item)}
                  node={node}
                  depth={0}
                  collapsed={collapsed}
                  activeKey={activeKey}
                  onToggle={toggleNode}
                  onJump={onOutlineJump}
                />
              ))
            )}
          </div>
        )}

        {panel === "extensions" && (
          <div className="panel-placeholder">
            <p className="panel-note">{t("sidebar.comingSoon")}</p>
          </div>
        )}

        {panel === "settings" && (
          <div className="settings-panel">
            <section className="settings-group">
              <h3 className="settings-group-title">{t("settings.appearance")}</h3>
              <label className="settings-row">
                <span className="settings-row-label">{t("settings.nativeTitleBar")}</span>
                <input
                  type="checkbox"
                  className="settings-checkbox"
                  checked={useNativeTitleBar}
                  onChange={onToggleNativeTitleBar}
                />
              </label>
              <p className="settings-desc">{t("settings.nativeTitleBarDesc")}</p>
              <label className="settings-row">
                <span className="settings-row-label">{t("settings.showLineNumbersSource")}</span>
                <input
                  type="checkbox"
                  className="settings-checkbox"
                  checked={showLineNumbersSource}
                  onChange={(e) => onSetShowLineNumbers("source", e.target.checked)}
                />
              </label>
              <label className="settings-row">
                <span className="settings-row-label">{t("settings.showLineNumbersWysiwyg")}</span>
                <input
                  type="checkbox"
                  className="settings-checkbox"
                  checked={showLineNumbersWysiwyg}
                  onChange={(e) => onSetShowLineNumbers("wysiwyg", e.target.checked)}
                />
              </label>
              <label className="settings-row">
                <span className="settings-row-label">{t("settings.cursorLineSource")}</span>
                <input
                  type="checkbox"
                  className="settings-checkbox"
                  checked={cursorLineSource}
                  onChange={onToggleCursorLineSource}
                />
              </label>
              <p className="settings-desc">{t("settings.cursorLineSourceDesc")}</p>
              <label className="settings-row">
                <span className="settings-row-label">{t("settings.highlightActiveLineSource")}</span>
                <input
                  type="checkbox"
                  className="settings-checkbox"
                  checked={highlightActiveLineSource}
                  onChange={(e) => onSetHighlightActiveLine("source", e.target.checked)}
                />
              </label>
              <label className="settings-row">
                <span className="settings-row-label">{t("settings.highlightActiveLineWysiwyg")}</span>
                <input
                  type="checkbox"
                  className="settings-checkbox"
                  checked={highlightActiveLineWysiwyg}
                  onChange={(e) => onSetHighlightActiveLine("wysiwyg", e.target.checked)}
                />
              </label>
            </section>

            <section className="settings-group">
              <h3 className="settings-group-title">{t("settings.startup")}</h3>
              <select
                className="settings-select"
                value={startupBehavior}
                onChange={(e) => onStartupBehaviorChange(e.target.value)}
              >
                <option value="welcome">{t("settings.startupWelcome")}</option>
                <option value="lastDir">{t("settings.startupLastDir")}</option>
                <option value="lastFile">{t("settings.startupLastFile")}</option>
              </select>
              <p className="settings-desc">{t("settings.startupDesc")}</p>
            </section>

            <section className="settings-group">
              <h3 className="settings-group-title">{t("settings.language")}</h3>
              <select
                className="settings-select"
                value={language}
                onChange={(e) => onChangeLanguage(e.target.value)}
              >
                <option value="system">{t("settings.languageSystem")}</option>
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
            </section>
          </div>
        )}
      </div>

      <div className="resize-handle" onMouseDown={onHandleMouseDown} />
    </aside>
  );
}
