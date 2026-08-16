import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from "react-i18next";
import { fileIconClass } from "../fileIcons";

/** 文件系统条目（对应 Rust 侧 FileEntry） */
interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

/** 目录轮询间隔（ms）：检测系统文件管理器中的外部增删改 */
const POLL_INTERVAL = 3000;

/** 两个目录列表是否等价（名称 + 类型集合，忽略顺序） */
function sameEntries(a: FileEntry[], b: FileEntry[]): boolean {
  if (a.length !== b.length) return false;
  const key = (e: FileEntry) => (e.is_dir ? "d:" : "f:") + e.name;
  const sa = new Set(a.map(key));
  return b.every((e) => sa.has(key(e)));
}

interface TreeNodeProps {
  entry: FileEntry;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
  /** 目录内容变更信号：匹配的目录重新拉取子项（path="*" 表示刷新所有） */
  reload: { path: string; version: number } | null;
  /** 请求重新拉取某目录 */
  requestReload: (path: string) => void;
  /** 当前正在新建条目的目录（显示行内输入框） */
  creating: { parent: string; kind: "file" | "dir" } | null;
  onCreatingDone: () => void;
  /** 在指定目录下新建 */
  onCreateIn: (parent: string, kind: "file" | "dir") => void;
  /** 正在重命名的条目路径 */
  renaming: string | null;
  setRenaming: (path: string | null) => void;
  onRename: (oldPath: string, newPath: string) => void;
  onDelete: (path: string) => void;
  onOpenMenu: (entry: FileEntry, x: number, y: number) => void;
  /** 当前选中的目录（新建条目的目标位置） */
  onTargetDirChange: (path: string | null) => void;
}

/** 行内输入（新建条目 / 重命名共用） */
function EntryInput({
  defaultValue,
  placeholder,
  onCommit,
  onCancel,
}: {
  defaultValue: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="tree-input"
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onCommit(value);
        else if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onCommit(value)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function TreeNode({
  entry,
  depth,
  selected,
  onSelect,
  reload,
  requestReload,
  creating,
  onCreatingDone,
  onCreateIn,
  renaming,
  setRenaming,
  onRename,
  onDelete,
  onOpenMenu,
  onTargetDirChange,
}: TreeNodeProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);

  const loadChildren = useCallback(async () => {
    try {
      setChildren(await invoke<FileEntry[]>("list_dir", { path: entry.path }));
    } catch (e) {
      console.error("list_dir failed:", e);
    }
  }, [entry.path]);

  // 目录内容变更 → 刷新（reload.path="*" 时刷新所有已展开目录）
  useEffect(() => {
    if (reload && (reload.path === entry.path || reload.path === "*") && expanded) {
      void loadChildren();
    }
  }, [reload, entry.path, expanded, loadChildren]);

  // 外部变化轮询：展开的目录每 POLL_INTERVAL 与磁盘比对（名称+类型），变化即刷新
  useEffect(() => {
    if (!expanded) return;
    const timer = setInterval(async () => {
      try {
        const list = await invoke<FileEntry[]>("list_dir", { path: entry.path });
        setChildren((prev) => (sameEntries(prev, list) ? prev : list));
      } catch {
        /* 目录被外部删除等：忽略，等下次轮询/刷新 */
      }
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [expanded, entry.path]);

  // 在该目录下新建 → 自动展开并加载
  const isCreatingHere = creating?.parent === entry.path;
  useEffect(() => {
    if (isCreatingHere && !expanded) {
      setExpanded(true);
      void loadChildren();
    }
  }, [isCreatingHere, expanded, loadChildren]);

  const toggle = () => {
    if (!entry.is_dir) {
      // 点击文件 → 新建目标切换到其所在目录
      const dir = entry.path.slice(0, entry.path.length - entry.name.length).replace(/[/\\]+$/, "");
      onTargetDirChange(dir || null);
      onSelect(entry.path);
      return;
    }
    // 点击目录 = 选中该目录作为新建目标
    onTargetDirChange(entry.path);
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (children.length === 0) void loadChildren();
  };

  const commitCreate = async (name: string) => {
    const n = name.trim();
    if (n && !/[/\\]/.test(n) && creating?.parent === entry.path) {
      try {
        await invoke("create_entry", { parent: entry.path, name: n, isDir: creating.kind === "dir" });
        requestReload(entry.path);
      } catch (e) {
        console.error("create failed:", e);
      }
    }
    onCreatingDone();
  };

  const commitRename = async (name: string) => {
    setRenaming(null);
    const n = name.trim();
    if (!n || /[/\\]/.test(n) || n === entry.name) return;
    // prefix 含尾部分隔符（保留原路径风格，如 C:\foo\）；dir 去掉分隔符用于 reload 匹配
    const prefix = entry.path.slice(0, entry.path.length - entry.name.length);
    const dir = prefix.replace(/[/\\]+$/, "");
    try {
      await invoke("rename_entry", { path: entry.path, newName: n });
      onRename(entry.path, prefix + n);
      requestReload(dir || entry.path);
    } catch (e) {
      console.error("rename failed:", e);
    }
  };

  const isRenaming = renaming === entry.path;

  return (
    <div>
      <div
        className={"tree-node" + (selected === entry.path ? " selected" : "")}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={toggle}
        onContextMenu={(e) => {
          e.preventDefault();
          onOpenMenu(entry, e.clientX, e.clientY);
        }}
        title={entry.path}
      >
        <span className={"tree-caret" + (entry.is_dir ? "" : " empty")}>
          {entry.is_dir && (
            <i
              className={"fa-solid " + (expanded ? "fa-chevron-down" : "fa-chevron-right")}
              aria-hidden="true"
            />
          )}
        </span>
        <span className="tree-icon">
          {entry.is_dir ? (
            <i className={"fa-solid " + (expanded ? "fa-folder-open" : "fa-folder")} aria-hidden="true" />
          ) : (
            <i className={fileIconClass(entry.name)} aria-hidden="true" />
          )}
        </span>
        {isRenaming ? (
          <EntryInput defaultValue={entry.name} onCommit={commitRename} onCancel={() => setRenaming(null)} />
        ) : (
          <span className="tree-name">{entry.name}</span>
        )}
      </div>

      {entry.is_dir && (expanded || isCreatingHere) && (
        <div>
          {isCreatingHere && (
            <div className="tree-node tree-new-row" style={{ paddingLeft: 6 + (depth + 1) * 12 }}>
              <span className="tree-icon">
                <i className={"fa-solid " + (creating.kind === "dir" ? "fa-folder" : "fa-file")} aria-hidden="true" />
              </span>
              <EntryInput
                defaultValue=""
                placeholder={creating.kind === "dir" ? t("filetree.newFolderName") : t("filetree.newFileName")}
                onCommit={commitCreate}
                onCancel={onCreatingDone}
              />
            </div>
          )}
          {children.map((c) => (
            <TreeNode
              key={c.path}
              entry={c}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              reload={reload}
              requestReload={requestReload}
              creating={creating}
              onCreatingDone={onCreatingDone}
              onCreateIn={onCreateIn}
              renaming={renaming}
              setRenaming={setRenaming}
              onRename={onRename}
              onDelete={onDelete}
              onOpenMenu={onOpenMenu}
              onTargetDirChange={onTargetDirChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileTreeProps {
  root: string;
  selected: string | null;
  onSelect: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => void;
  onDelete: (path: string) => void;
  /** 当前正在新建条目的目录 */
  creating: { parent: string; kind: "file" | "dir" } | null;
  onCreatingDone: () => void;
  /** 在指定目录下新建（右键菜单/头部按钮） */
  onCreateIn: (parent: string, kind: "file" | "dir") => void;
  /** 当前选中的目录（头部按钮新建的目标位置） */
  targetDir: string | null;
  onTargetDirChange: (path: string | null) => void;
  /** 外部刷新信号（App 轮询/刷新按钮触发：{path, version}，path="*" 刷新全部展开目录） */
  externalReload: { path: string; version: number } | null;
}

interface MenuState {
  entry: FileEntry;
  x: number;
  y: number;
}

/** 文件树（懒加载 + 右键菜单 + 行内新建/重命名 + 删除确认 + 外部变化轮询） */
export function FileTree({
  root,
  selected,
  onSelect,
  onRename,
  onDelete,
  creating,
  onCreatingDone,
  onCreateIn,
  targetDir,
  onTargetDirChange,
  externalReload,
}: FileTreeProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [reload, setReload] = useState<{ path: string; version: number } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const loadRoot = useCallback(async () => {
    try {
      setEntries(await invoke<FileEntry[]>("list_dir", { path: root }));
    } catch (e) {
      console.error("list_dir failed:", e);
    }
  }, [root]);

  useEffect(() => {
    void loadRoot();
  }, [loadRoot]);

  // 根目录内容变更 → 刷新（path="*" 时也刷新）
  useEffect(() => {
    if (reload && (reload.path === root || reload.path === "*")) void loadRoot();
  }, [reload, root, loadRoot]);

  // 外部刷新信号（App 轮询/刷新按钮）→ 并入内部 reload 机制
  useEffect(() => {
    if (externalReload) setReload(externalReload);
  }, [externalReload]);

  // 外部变化轮询：根目录每 POLL_INTERVAL 与磁盘比对（名称+类型），变化即刷新
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const list = await invoke<FileEntry[]>("list_dir", { path: root });
        setEntries((prev) => (sameEntries(prev, list) ? prev : list));
      } catch {
        /* 根目录被移除等：忽略 */
      }
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [root]);

  const requestReload = useCallback((path: string) => {
    setReload((r) => ({ path, version: (r?.version ?? 0) + 1 }));
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const doDelete = useCallback(
    async (entry: FileEntry) => {
      const ok = await ask(t("filetree.confirmDelete", { name: entry.name }), {
        kind: "warning",
        title: t("filetree.delete"),
      });
      if (!ok) return;
      try {
        await invoke("delete_entry", { path: entry.path });
        onDelete(entry.path);
        if (targetDir === entry.path) onTargetDirChange(null);
        const dir = entry.path.slice(0, entry.path.length - entry.name.length).replace(/[/\\]+$/, "");
        requestReload(dir || root);
      } catch (e) {
        console.error("delete failed:", e);
      }
    },
    [t, onDelete, requestReload, root, targetDir, onTargetDirChange],
  );

  const menuItems: { label: string; run: () => void }[] = menu
    ? [
        {
          label: t("filetree.copyPath"),
          run: () => {
            // 复制相对路径（相对当前根目录，如 docs/readme.md）
            const rel = menu.entry.path.startsWith(root)
              ? menu.entry.path.slice(root.length).replace(/^[/\\]+/, "")
              : menu.entry.path;
            void writeText(rel).catch((e) => console.error("copy failed:", e));
            closeMenu();
          },
        },
        {
          label: t("filetree.copyAbsolutePath"),
          run: () => {
            void writeText(menu.entry.path).catch((e) => console.error("copy failed:", e));
            closeMenu();
          },
        },
        ...(menu.entry.is_dir
          ? [
              {
                label: t("filetree.newFile"),
                run: () => {
                  onCreateIn(menu.entry.path, "file");
                  closeMenu();
                },
              },
              {
                label: t("filetree.newFolder"),
                run: () => {
                  onCreateIn(menu.entry.path, "dir");
                  closeMenu();
                },
              },
            ]
          : []),
        {
          label: t("filetree.revealInExplorer"),
          run: () => {
            void revealItemInDir(menu.entry.path).catch((e) => console.error("reveal failed:", e));
            closeMenu();
          },
        },
        { label: t("filetree.rename"), run: () => { setRenaming(menu.entry.path); closeMenu(); } },
        { label: t("filetree.delete"), run: () => { void doDelete(menu.entry); closeMenu(); } },
      ]
    : [];

  if (entries.length === 0 && !creating) {
    return <div className="tree-empty">{t("sidebar.emptyDir")}</div>;
  }

  return (
    <div
      className="file-tree"
      onClick={(e) => {
        // 点击树空白区域 → 新建目标重置为根目录
        if (e.target === e.currentTarget) onTargetDirChange(null);
      }}
    >
      {creating?.parent === root && (
        <div className="tree-node tree-new-row" style={{ paddingLeft: 6 }}>
          <span className="tree-icon">
            <i className={"fa-solid " + (creating.kind === "dir" ? "fa-folder" : "fa-file")} aria-hidden="true" />
          </span>
          <EntryInput
            defaultValue=""
            placeholder={creating.kind === "dir" ? t("filetree.newFolderName") : t("filetree.newFileName")}
            onCommit={async (name) => {
              const n = name.trim();
              if (n && !/[/\\]/.test(n)) {
                try {
                  await invoke("create_entry", { parent: root, name: n, isDir: creating.kind === "dir" });
                  requestReload(root);
                } catch (e) {
                  console.error("create failed:", e);
                }
              }
              onCreatingDone();
            }}
            onCancel={onCreatingDone}
          />
        </div>
      )}
      {entries.map((e) => (
        <TreeNode
          key={e.path}
          entry={e}
          depth={0}
          selected={selected}
          onSelect={onSelect}
          reload={reload}
          requestReload={requestReload}
          creating={creating}
          onCreatingDone={onCreatingDone}
          onCreateIn={onCreateIn}
          renaming={renaming}
          setRenaming={setRenaming}
          onRename={(oldPath, newPath) => {
            if (targetDir === oldPath) onTargetDirChange(newPath);
            onRename(oldPath, newPath);
          }}
          onDelete={onDelete}
          onOpenMenu={(entry, x, y) => {
            if (entry.is_dir) onTargetDirChange(entry.path);
            setMenu({ entry, x, y });
          }}
          onTargetDirChange={onTargetDirChange}
        />
      ))}

      {menu && (
        <>
          <div
            className="tree-menu-overlay"
            onClick={closeMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeMenu();
            }}
          />
          <div className="tree-menu" style={{ left: menu.x, top: menu.y }} role="menu">
            {menuItems.map((it) => (
              <button key={it.label} type="button" className="tree-menu-item" role="menuitem" onClick={it.run}>
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
