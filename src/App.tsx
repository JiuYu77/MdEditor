import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog, ask, message } from "@tauri-apps/plugin-dialog";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl, openPath as openWithDefaultApp } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createEditor, assetImageUrlResolver, normalizeLocalPath, type EditorInstance, type EditorMode, type OutlineItem } from "@mdeditor/md-editor";
import { normalizeTables } from "./normalizeTables";
import { ActivityBar, type PanelId } from "./components/ActivityBar";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { MenuBar, type MenuDef } from "./components/MenuBar";
import { WelcomePage } from "./components/WelcomePage";
import { basename } from "./utils/path";
import i18n from "./i18n";
import "./App.css";

/** 应用设置（对应 Rust 侧 Settings，settings.json 持久化，见 §3.5.3） */
interface AppSettings {
  nativeTitleBar: boolean;
  language: string;
  sidebarWidth: number;
  /** 显示行号（源码模式），默认 true */
  showLineNumbersSource: boolean;
  /** 显示行号（所见即所得模式），默认 false */
  showLineNumbersWysiwyg: boolean;
  /** 光标所在行显示 Markdown 源码 */
  cursorLineSource: boolean;
  /** 高亮当前行（源码模式），默认 true */
  highlightActiveLineSource: boolean;
  /** 高亮当前行（所见即所得模式），默认 false */
  highlightActiveLineWysiwyg: boolean;
  /** 启动行为：welcome（新窗口/欢迎页）| lastDir（上次打开的目录）| lastFile（上次打开的文件） */
  startupBehavior: string;
  /** 上次打开的目录 */
  lastDir: string | null;
  /** 上次打开的文件 */
  lastFile: string | null;
  /** 最近打开（新→旧，文件与文件夹统一按时间排序，欢迎页历史记录） */
  recent: RecentItem[];
  /** 上次窗口大小（逻辑像素，窗口 resize 时记录，下次启动由 Rust setup 恢复） */
  windowWidth: number | null;
  windowHeight: number | null;
  /** 上次窗口位置（逻辑像素，窗口移动时记录，下次启动恢复） */
  windowX: number | null;
  windowY: number | null;
}

const DEFAULT_SETTINGS: AppSettings = {
  nativeTitleBar: false,
  language: "system",
  sidebarWidth: 240,
  showLineNumbersSource: true,
  showLineNumbersWysiwyg: false,
  cursorLineSource: true,
  highlightActiveLineSource: true,
  highlightActiveLineWysiwyg: false,
  startupBehavior: "welcome",
  lastDir: null,
  lastFile: null,
  recent: [],
  windowWidth: null,
  windowHeight: null,
  windowX: null,
  windowY: null,
};

/** 主题模式（data-theme 属性控制，仅本次会话生效，持久化后续接入主题包） */
type ThemeMode = "system" | "light" | "dark";

/** 文件元信息（Rust file_meta 返回值：外部修改检测用） */
interface FileMeta {
  modified: number;
  size: number;
}

/** 统计：字符数 = 非空白字符数 */
function countChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

/** 从路径取所在目录（兼容 / 与 \ 分隔符） */
function dirname(path: string): string {
  const sep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return sep > 0 ? path.slice(0, sep) : "";
}

/** 未命名缓冲区虚拟路径标识（VS Code 式：新建文件不落盘，保存时才选位置） */
const UNTITLED_PREFIX = "untitled:/";
function isUntitledPath(path: string | null): path is string {
  return !!path && path.startsWith(UNTITLED_PREFIX);
}

/** 支持打开的文件格式（md / markdown / txt）；其他格式点击不做任何反应 */
const SUPPORTED_FILE_RE = /\.(md|markdown|txt)$/i;

/** 拼接目录与文件名（保留目录原有分隔符风格） */
function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + name;
}

/** 最近打开条目（文件与文件夹统一按时间排序） */
interface RecentItem {
  path: string;
  isDir: boolean;
  /** 打开时间戳（毫秒），新→旧排序依据 */
  time: number;
}

/** 最近记录：置顶 + 按路径去重 + 截断（新→旧） */
function pushRecentItem(list: RecentItem[], item: RecentItem, cap = 8): RecentItem[] {
  return [item, ...list.filter((x) => x.path !== item.path)].slice(0, cap);
}

/** 系统语言映射 */
function systemLang(): string {
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

/** 应用语言到 i18n */
function applyLanguage(language: string): void {
  const target = language === "system" ? systemLang() : language;
  i18n.changeLanguage(target).catch(console.error);
}

/**
 * MdEditor 主界面（桌面 UI 布局）
 * 结构：标题栏（无边框时自绘）+ 菜单栏 + 活动栏 + 侧边栏 + 编辑区 + 状态栏
 * 详见需求文档 §5 界面布局草案、§3.4.2 菜单栏、§3.4.3 标题栏自定义。
 */
function App() {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<PanelId | null>("explorer");
  const [rootDir, setRootDir] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<EditorMode>("wysiwyg");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("system");
  /** 当前文档字符数（状态栏显示；编辑器为数据源，防抖统计；无文件为 null） */
  const [charCount, setCharCount] = useState<number | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  /** 当前文件所在目录（图片相对路径解析基准；未命名/无文件时为 null） */
  const currentDirRef = useRef<string | null>(null);
  useEffect(() => {
    currentDirRef.current = selected && !isUntitledPath(selected) ? dirname(selected) : null;
  }, [selected]);
  /** 链接点击去重时间戳（编辑器 mousedown + click 双触发 openLink 回调） */
  const lastLinkClickRef = useRef(0);
  /** 左侧区域（活动栏 + 侧边栏）是否可见（状态栏按钮切换） */
  const [leftVisible, setLeftVisible] = useState(true);
  /** 文件树外部刷新信号（{path, version}；path="*" 刷新全部展开目录） */
  const [treeExternalReload, setTreeExternalReload] = useState<{ path: string; version: number } | null>(null);

  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorInstance | null>(null);
  const selectedRef = useRef<string | null>(null);
  const panelRef = useRef<PanelId | null>(panel);
  const outlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorRafRef = useRef<number>(0);
  /** 当前打开文件的元信息缓存（mtime+size，外部修改检测） */
  const currentFileMetaRef = useRef<FileMeta | null>(null);
  /** 已提示过的文件版本（避免同一版本重复弹窗） */
  const promptedFileMetaKeyRef = useRef("");
  /** dirty 的最新值（供异步回调/关闭拦截读取） */
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // 文件树刷新按钮：强制重新拉取根目录 + 全部已展开目录（path="*"，不重挂载、保留展开状态）
  const handleRefreshTree = useCallback(() => {
    setTreeExternalReload((r) => ({ path: "*", version: (r?.version ?? 0) + 1 }));
  }, []);

  // 刷新当前文件的元信息缓存（保存/打开后调用，避免把自家写入误判为外部修改）
  const refreshCurrentFileMeta = useCallback(async (path: string) => {
    try {
      currentFileMetaRef.current = await invoke<FileMeta>("file_meta", { path });
      promptedFileMetaKeyRef.current = "";
    } catch (e) {
      console.error("file_meta failed:", e);
    }
  }, []);

  // 正在编辑文件的外部修改检测：每 2s 比对 mtime+size，
  // 文件在系统文件管理器/其他程序中被改动时提示"是否重新加载"
  useEffect(() => {
    if (!selected || isUntitledPath(selected) || !SUPPORTED_FILE_RE.test(selected)) return;
    const path = selected;
    currentFileMetaRef.current = null;
    promptedFileMetaKeyRef.current = "";
    void refreshCurrentFileMeta(path);
    const timer = setInterval(async () => {
      try {
        const meta = await invoke<FileMeta>("file_meta", { path });
        const cached = currentFileMetaRef.current;
        if (!cached) {
          currentFileMetaRef.current = meta;
          return;
        }
        const changed = meta.modified !== cached.modified || meta.size !== cached.size;
        if (!changed) return;
        currentFileMetaRef.current = meta;
        const key = `${meta.modified}:${meta.size}`;
        if (promptedFileMetaKeyRef.current === key) return; // 该版本已提示过
        promptedFileMetaKeyRef.current = key;
        const ok = await ask(t("editor.fileChangedReload"), {
          title: t("editor.fileChanged"),
          kind: "warning",
          okLabel: t("editor.reload"),
          cancelLabel: t("editor.ignore"),
        });
        if (!ok) return;
        try {
          const text = await invoke<string>("read_file", { path });
          editorRef.current?.setValue(text);
          setDirty(false);
          promptedFileMetaKeyRef.current = "";
          void refreshCurrentFileMeta(path);
        } catch (e) {
          console.error("reload failed:", e);
        }
      } catch (e) {
        console.error("file_meta failed:", e);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [selected, t, refreshCurrentFileMeta]);

  // 启动：读取 settings.json → 应用标题栏模式/语言 → 按启动行为恢复目录或上次文件。
  // 不默认挂载用户主目录：未打开过文件夹时侧边栏显示"打开文件夹"引导
  useEffect(() => {
    (async () => {
      let s: AppSettings = DEFAULT_SETTINGS;
      try {
        s = await invoke<AppSettings>("read_settings");
        setSettings(s);
        if (s.nativeTitleBar) {
          getCurrentWindow().setDecorations(true).catch(console.error);
        }
        applyLanguage(s.language);
      } catch (e) {
        console.error("read_settings failed:", e);
      }
      // 启动显隐：启动方式为「新窗口/欢迎页」时隐藏活动栏与侧边栏（干净欢迎界面）；
      // 恢复上次目录/文件时保持显示
      if (s.startupBehavior === "lastDir" && s.lastDir) {
        setRootDir(s.lastDir);
        setLeftVisible(true);
      } else if (s.startupBehavior === "lastFile" && s.lastFile) {
        setRootDir(dirname(s.lastFile));
        openFileRef.current(s.lastFile, false);
        setLeftVisible(true);
      } else {
        setLeftVisible(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题：data-theme 属性（空 = 跟随系统），CSS 里 :root[data-theme] 覆盖
  useEffect(() => {
    const docEl = document.documentElement;
    if (theme === "system") delete docEl.dataset.theme;
    else docEl.dataset.theme = theme;
  }, [theme]);

  // 窗口大小变化 → 防抖 500ms 记录到 settings.json（下次启动由 Rust setup 恢复）
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win
      .onResized(async () => {
        if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = setTimeout(async () => {
          try {
            // 最大化状态下不记录（保留上次普通窗口尺寸作为下次恢复值）
            if (await win.isMaximized()) return;
            const phys = await win.outerSize();
            const scale = await win.scaleFactor();
            const logical = {
              width: Math.round(phys.width / scale),
              height: Math.round(phys.height / scale),
            };
            // 异常尺寸不记录：窗口被拖到极矮/最大化过渡值（如 33px 高）会污染记忆，
            // 下次启动恢复成"只有标题栏"。tauri.conf minWidth/minHeight 为 640x480。
            if (logical.width < 640 || logical.height < 480) return;
            setSettings((prev) => {
              if (prev.windowWidth === logical.width && prev.windowHeight === logical.height) return prev;
              const next = { ...prev, windowWidth: logical.width, windowHeight: logical.height };
              invoke("write_settings", { settings: next }).catch(console.error);
              return next;
            });
          } catch (e) {
            console.error("window size persist failed:", e);
          }
        }, 500);
      })
      .then((fn) => (unlisten = fn))
      .catch(console.error);
    return () => {
      unlisten?.();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    };
  }, []);

  // 窗口位置变化 → 防抖 500ms 记录到 settings.json（逻辑坐标，下次启动由 Rust setup 恢复）
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win
      .onMoved(async () => {
        if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
        moveTimerRef.current = setTimeout(async () => {
          try {
            // 最大化状态下不记录（保留上次普通窗口位置作为下次恢复值）
            if (await win.isMaximized()) return;
            const phys = await win.outerPosition();
            const scale = await win.scaleFactor();
            const logical = { x: Math.round(phys.x / scale), y: Math.round(phys.y / scale) };
            setSettings((prev) => {
              if (prev.windowX === logical.x && prev.windowY === logical.y) return prev;
              const next = { ...prev, windowX: logical.x, windowY: logical.y };
              invoke("write_settings", { settings: next }).catch(console.error);
              return next;
            });
          } catch (e) {
            console.error("window position persist failed:", e);
          }
        }, 500);
      })
      .then((fn) => (unlisten = fn))
      .catch(console.error);
    return () => {
      unlisten?.();
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
    };
  }, []);

  // 大纲刷新：编辑器变更后防抖 400ms 解析（仅大纲面板打开时，避免大文档无谓扫描）
  const refreshOutline = useCallback(() => {
    outlineTimerRef.current = null;
    setOutline(editorRef.current?.getOutline() ?? []);
  }, []);

  const scheduleOutline = useCallback(() => {
    if (outlineTimerRef.current) clearTimeout(outlineTimerRef.current);
    outlineTimerRef.current = setTimeout(refreshOutline, 400);
  }, [refreshOutline]);

  // 字符数统计：编辑器变化后防抖 400ms（大文档避免每键全量扫描）
  const countTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleCount = useCallback(() => {
    if (countTimerRef.current) clearTimeout(countTimerRef.current);
    countTimerRef.current = setTimeout(() => {
      const text = editorRef.current?.getValue() ?? "";
      setCharCount(text ? countChars(text) : null);
    }, 400);
  }, []);

  // 创建编辑器实例（仅一次，切换文件用 setValue 更新内容）
  useEffect(() => {
    if (!editorHostRef.current) return;
    const inst = createEditor(editorHostRef.current, {
      value: "",
      mode: "wysiwyg",
      lineNumbers: {
        source: settings.showLineNumbersSource,
        wysiwyg: settings.showLineNumbersWysiwyg,
      },
      cursorLineSource: settings.cursorLineSource,
      highlightActiveLine: {
        source: settings.highlightActiveLineSource,
        wysiwyg: settings.highlightActiveLineWysiwyg,
      },
      placeholder: t("editor.placeholder"),
      // 图片 URL 解析：外链/data 原样；本地路径 → 相对当前文件目录 → Tauri asset 协议 URL
      // （库内 assetImageUrlResolver 生成 http://asset.localhost/...，与 convertFileSrc 一致）
      resolveImageUrl: (raw) => assetImageUrlResolver(raw, currentDirRef.current),
      onChange: () => {
        // 性能优化：编辑器是唯一数据源，不每键搬运全文到 React state，
        // 仅标记 dirty；保存时从编辑器 getValue() 读取
        setDirty(true);
        if (panelRef.current === "outline") scheduleOutline();
        scheduleCount();
      },
      onSave: () => handleSaveRef.current(),
    });
    // 光标变化（rAF 合并）：状态栏行/列 + 大纲当前章节高亮
    inst.onCursorChange((line, col) => {
      cancelAnimationFrame(cursorRafRef.current);
      cursorRafRef.current = requestAnimationFrame(() => {
        setCursor((prev) => (prev && prev.line === line && prev.col === col ? prev : { line, col }));
      });
    });
    // 点击渲染后的链接（Typora 式）：
    //   http(s)/mailto 等远程 → 系统浏览器；#锚点 → 暂忽略；
    //   本地相对路径 → 按当前文件目录解析并归一化 `..`；
    //     .md/.markdown/.txt → 编辑器内打开；其他本地文件 → 系统默认应用
    inst.onOpenLink((url) => {
      // mousedown + click 双触发，300ms 内去重
      const now = Date.now();
      if (now - lastLinkClickRef.current < 300) return;
      lastLinkClickRef.current = now;
      // openUrl 权限仅放行 http/https/mailto/tel；#锚点暂忽略（未来做文档内跳转）
      if (/^(https?:|mailto:|tel:)/i.test(url)) {
        void openUrl(url).catch((e) => console.error("open link failed:", e));
        return;
      }
      if (/^(data:|ftp:|#)/i.test(url) || url.startsWith("#")) return;
      const base = currentDirRef.current;
      let abs = url;
      if (!/^([a-zA-Z]:[\\/]|\\\\|[\\/])/.test(url)) {
        if (!base) return; // 未命名文件无基准目录，无法解析相对路径
        const sep = base.includes("\\") ? "\\" : "/";
        abs = base.replace(/[\\/]+$/, "") + sep + url;
      }
      abs = normalizeLocalPath(abs);
      if (SUPPORTED_FILE_RE.test(abs)) {
        void openFileRef.current(abs, true);
        return;
      }
      void openWithDefaultApp(abs).catch((e) => console.error("open file failed:", e));
    });
    editorRef.current = inst;
    return () => {
      inst.destroy();
      editorRef.current = null;
      if (outlineTimerRef.current) clearTimeout(outlineTimerRef.current);
      cancelAnimationFrame(cursorRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 行号设置同步到编辑器（设置变化时即时生效，两种模式分开）
  useEffect(() => {
    editorRef.current?.setLineNumbers(settings.showLineNumbersSource, "source");
    editorRef.current?.setLineNumbers(settings.showLineNumbersWysiwyg, "wysiwyg");
  }, [settings.showLineNumbersSource, settings.showLineNumbersWysiwyg]);

  // 光标行源码显示设置同步到编辑器
  useEffect(() => {
    editorRef.current?.setCursorLineSource(settings.cursorLineSource);
  }, [settings.cursorLineSource]);

  // 高亮当前行设置同步到编辑器（两种模式分开）
  useEffect(() => {
    editorRef.current?.setHighlightActiveLine(settings.highlightActiveLineSource, "source");
    editorRef.current?.setHighlightActiveLine(settings.highlightActiveLineWysiwyg, "wysiwyg");
  }, [settings.highlightActiveLineSource, settings.highlightActiveLineWysiwyg]);

  // 打开大纲面板时立即刷新一次（可能已在后台编辑过）
  useEffect(() => {
    panelRef.current = panel;
    if (panel === "outline") refreshOutline();
  }, [panel, refreshOutline]);

  // 未打开文件时显示欢迎页（WelcomePage 组件，见 §5.2）
  useEffect(() => {
    if (!selected) setDirty(false);
  }, [selected]);

  // 保存当前文件（Ctrl+S 或状态栏/菜单触发）
  const handleSave = useCallback(async () => {
    const path = selectedRef.current;
    if (!path) return;
    // 保存前规范化表格：WYSIWYG 渲染下管道符被隐藏，编辑可能损坏表格结构，
    // 写文件前统一修复（正常表格逐字节不变，见 normalizeTables.ts）
    const raw = editorRef.current?.getValue() ?? "";
    const text = normalizeTables(raw);
    try {
      // 未命名缓冲区：弹保存对话框（VS Code 式），保存后切换为真实路径
      if (isUntitledPath(path)) {
        const name = basename(path);
        const defaultPath = rootDir ? joinPath(rootDir, name) : name;
        const file = await saveDialog({
          defaultPath,
          title: t("menu.save"),
          filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
        });
        if (typeof file !== "string" || !file) return; // 取消 → 仍保持未保存状态
        await invoke("write_file", { path: file, content: text });
        selectedRef.current = file;
        setSelected(file);
        setDirty(false);
        void refreshCurrentFileMeta(file);
        setSettings((prev) => {
          const next = {
            ...prev,
            lastFile: file,
            lastDir: dirname(file) || prev.lastDir,
            recent: pushRecentItem(prev.recent ?? [], { path: file, isDir: false, time: Date.now() }),
          };
          invoke("write_settings", { settings: next }).catch(console.error);
          return next;
        });
        setTreeVersion((v) => v + 1);
        return;
      }
      await invoke("write_file", { path, content: text });
      setDirty(false);
      void refreshCurrentFileMeta(path); // 自家写入也改 mtime，需刷新缓存避免误判外部修改
    } catch (e) {
      console.error("save failed:", e);
    }
  }, [t, refreshCurrentFileMeta, rootDir]);

  // 保持 handleSave 最新引用，供编辑器 onSave 回调调用
  const handleSaveRef = useRef(handleSave);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  });

  // 未保存更改保护：有未保存修改时弹「保存 / 不保存 / 取消」，无修改直接放行
  // 返回 "save" | "discard" | "cancel"，由调用方决定后续（保存/丢弃/中止）
  const guardUnsaved = useCallback(async (): Promise<"save" | "discard" | "cancel"> => {
    const path = selectedRef.current;
    if (!dirtyRef.current || !path) return "save";
    const picked = await message(t("editor.unsavedChanges", { name: basename(path) }), {
      title: t("editor.unsavedTitle"),
      kind: "warning",
      buttons: { yes: t("editor.save"), no: t("editor.dontSave"), cancel: t("editor.cancel") },
    });
    if (picked === t("editor.save")) return "save";
    if (picked === t("editor.dontSave")) return "discard";
    return "cancel";
  }, [t]);

  // 窗口关闭拦截（标题栏 × / 菜单退出 / 系统关闭）：未保存修改时先提示
  // 注意：Tauri 的 onCloseRequested 包装器在 handler 未 preventDefault 时会自动调用
  // window.destroy()，因此 capability 必须包含 core:window:allow-destroy，否则关闭被拒
  useEffect(() => {
    const win = getCurrentWindow();
    let closing = false;
    let unlisten: (() => void) | undefined;
    win
      .onCloseRequested(async (event) => {
        if (!dirtyRef.current) return; // 无未保存修改 → 正常关闭
        event.preventDefault();
        const g = await guardUnsaved();
        if (g === "cancel") return;
        if (g === "save") await handleSave();
        if (!closing) {
          closing = true;
          win.destroy().catch(console.error);
        }
      })
      .then((fn) => (unlisten = fn))
      .catch(console.error);
    return () => {
      unlisten?.(); // 依赖变化时先注销旧监听，避免重复注册导致多次弹窗
    };
  }, [guardUnsaved, handleSave]);

  // 新建文件（VS Code 式未命名缓冲区：不落盘，保存/关闭时才提示选择位置）
  const handleNewFile = useCallback(async () => {
    // 未保存更改保护：新建会替换当前编辑内容
    if (dirtyRef.current) {
      const g = await guardUnsaved();
      if (g === "cancel") return;
      if (g === "save") await handleSave();
    }
    const name = `未命名-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.md`;
    const untitledPath = UNTITLED_PREFIX + name;
    const text = `# ${name.replace(/\.md$/, "")}\n`;
    selectedRef.current = untitledPath;
    setSelected(untitledPath);
    editorRef.current?.setValue(text);
    setDirty(false); // 尚未编辑；用户输入后自动标记未保存
    setCursor(null);
  }, [guardUnsaved, handleSave]);

  // 关闭当前文件（回到欢迎页）：未保存更改保护
  const handleCloseFile = useCallback(async () => {
    if (dirtyRef.current) {
      const g = await guardUnsaved();
      if (g === "cancel") return;
      if (g === "save") await handleSave();
    }
    selectedRef.current = null;
    setSelected(null);
    setDirty(false);
    setCursor(null);
  }, [guardUnsaved, handleSave]);

  // 另存为（文件菜单）：保存对话框 → 写入 → 切换到新文件
  const handleSaveAs = useCallback(async () => {
    const raw = editorRef.current?.getValue() ?? "";
    const text = normalizeTables(raw);
    try {
      const current = selectedRef.current;
      const defaultPath =
        !current || isUntitledPath(current) ? (rootDir ? joinPath(rootDir, basename(current ?? "未命名.md")) : undefined) : current;
      const file = await saveDialog({
        defaultPath,
        title: t("menu.saveAs"),
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      });
      if (typeof file !== "string" || !file) return;
      await invoke("write_file", { path: file, content: text });
      selectedRef.current = file;
      setSelected(file);
      setDirty(false);
      void refreshCurrentFileMeta(file);
      setSettings((prev) => {
        const next = {
          ...prev,
          lastFile: file,
          lastDir: dirname(file) || prev.lastDir,
          recent: pushRecentItem(prev.recent ?? [], { path: file, isDir: false, time: Date.now() }),
        };
        invoke("write_settings", { settings: next }).catch(console.error);
        return next;
      });
      setTreeVersion((v) => v + 1);
    } catch (e) {
      console.error("save as failed:", e);
    }
  }, [t, refreshCurrentFileMeta, rootDir]);

  // 文件树重命名完成：选中文件路径同步更新
  const handleEntryRenamed = useCallback((oldPath: string, newPath: string) => {
    if (selectedRef.current === oldPath) {
      selectedRef.current = newPath;
      setSelected(newPath);
    }
  }, []);

  // 文件树删除完成：被删文件（或其子项）处于打开状态则关闭
  const handleEntryDeleted = useCallback((path: string) => {
    const sel = selectedRef.current;
    if (sel && (sel === path || sel.startsWith(path + "/") || sel.startsWith(path + "\\"))) {
      selectedRef.current = null;
      setSelected(null);
      setDirty(false);
      setCursor(null);
    }
  }, []);

  const handleQuit = useCallback(() => {
    getCurrentWindow().close().catch(console.error);
  }, []);

  // 打开文件：仅支持 md / markdown / txt；其他格式点击不做任何反应
  // fromUser=true 时记录"上次打开的文件"与其所在目录（启动自动恢复用）
  const openFile = useCallback(
    async (path: string, fromUser: boolean) => {
      // 不支持的格式：直接忽略（不切换、不提示保存、不记录最近，无任何副作用）
      if (!SUPPORTED_FILE_RE.test(path)) return;
      // 点击已打开的文件：直接忽略（避免重读磁盘丢掉未保存修改）
      if (path === selectedRef.current) return;
      // 未保存更改保护：切换文件前提示保存/不保存/取消
      if (dirtyRef.current) {
        const g = await guardUnsaved();
        if (g === "cancel") return;
        if (g === "save") await handleSave();
      }
      const finish = () => {
        if (fromUser) {
          setSettings((prev) => {
            const next = {
              ...prev,
              lastFile: path,
              lastDir: dirname(path) || prev.lastDir,
              recent: pushRecentItem(prev.recent ?? [], { path, isDir: false, time: Date.now() }),
            };
            invoke("write_settings", { settings: next }).catch(console.error);
            return next;
          });
        }
      };
      selectedRef.current = path;
      setSelected(path);
      invoke<string>("read_file", { path })
        .then((text) => {
          editorRef.current?.setValue(text);
          setDirty(false);
          void refreshCurrentFileMeta(path);
          finish();
        })
        .catch((e) => {
          console.error(e);
          const msg = `# ${t("editor.cannotOpen")}\n\n${String(e)}`;
          editorRef.current?.setValue(msg);
          setDirty(false);
        });
    },
    [t, refreshCurrentFileMeta, guardUnsaved, handleSave],
  );

  // 保持最新引用，供启动流程（挂载时）调用
  const openFileRef = useRef(openFile);
  useEffect(() => {
    openFileRef.current = openFile;
  });

  // 文件树点击 → 用户打开（记录上次文件）
  const handleSelect = useCallback(
    (path: string) => {
      openFile(path, true);
    },
    [openFile],
  );

  // 全局搜索点击结果 → 打开文件并跳转行（等文档加载到目标行后再跳，最多重试 ~2s）
  const handleSearchOpen = useCallback(
    (path: string, line: number) => {
      const jump = () => {
        const ed = editorRef.current;
        if (!ed) return;
        let tries = 0;
        const attempt = () => {
          tries++;
          const loadedLines = ed.getValue().split("\n").length;
          if (loadedLines >= line || tries > 40) {
            ed.setCursorLine(line, true);
            ed.focus();
          } else {
            setTimeout(attempt, 50);
          }
        };
        attempt();
      };
      if (path === selectedRef.current) {
        jump();
        return;
      }
      void openFile(path, true).then(jump);
    },
    [openFile],
  );

  // 打开文件夹（原生目录选择器）→ 设为侧边栏根目录并持久化 lastDir + 历史
  const handleOpenFolder = useCallback(
    async (path?: string) => {
      let dir = path;
      if (!dir) {
        try {
          const picked = await openDialog({ directory: true, multiple: false, title: t("menu.openFolder") });
          if (typeof picked !== "string" || !picked) return;
          dir = picked;
        } catch (e) {
          console.error("open folder failed:", e);
          return;
        }
      }
      setRootDir(dir);
      // 打开文件夹后确保活动栏/侧边栏可见（欢迎页启动时可能已隐藏）；
      // 面板为空时恢复文件资源管理器
      setLeftVisible(true);
      setPanel((p) => (p === null ? "explorer" : p));
      setTreeVersion((v) => v + 1);
      setSettings((prev) => {
        const next = {
          ...prev,
          lastDir: dir,
          recent: pushRecentItem(prev.recent ?? [], { path: dir, isDir: true, time: Date.now() }),
        };
        invoke("write_settings", { settings: next }).catch(console.error);
        return next;
      });
    },
    [t],
  );

  // 从历史中移除单条（欢迎页 × 按钮）；若被移除项是"上次打开"则回退到新的首条
  const removeRecent = useCallback((path: string) => {
    setSettings((prev) => {
      const recent = (prev.recent ?? []).filter((x) => x.path !== path);
      const next = { ...prev, recent };
      const firstFile = recent.find((x) => !x.isDir);
      const firstDir = recent.find((x) => x.isDir);
      if (prev.lastFile === path) next.lastFile = firstFile?.path ?? null;
      if (prev.lastDir === path) next.lastDir = firstDir?.path ?? null;
      invoke("write_settings", { settings: next }).catch(console.error);
      return next;
    });
  }, []);

  // 欢迎页"最近记录"点击：先校验路径是否还存在；已被删除 → 提示从最近记录中移除
  const handleOpenRecent = useCallback(
    async (kind: "file" | "folder", path: string) => {
      let exists = false;
      try {
        exists = await invoke<boolean>("path_exists", { path });
      } catch (e) {
        console.error("path_exists failed:", e);
        exists = true; // 校验失败时按存在处理（尝试打开）
      }
      if (!exists) {
        const ok = await ask(t("welcome.recordDeleted", { name: basename(path) }), {
          title: t("welcome.recent"),
          kind: "warning",
          okLabel: t("welcome.removeRecord"),
          cancelLabel: t("editor.cancel"),
        });
        if (ok) removeRecent(path);
        return;
      }
      if (kind === "file") {
        openFile(path, true);
      } else {
        setPanel("explorer");
        void handleOpenFolder(path);
      }
    },
    [openFile, handleOpenFolder, removeRecent, t],
  );

  // 打开文件（原生文件选择器，仅 Markdown）
  const handleOpenFile = useCallback(async () => {
    try {
      const file = await openDialog({
        multiple: false,
        directory: false,
        title: t("menu.openFile"),
        filters: [{ name: "文本文件", extensions: ["md", "markdown", "txt"] }],
      });
      if (typeof file === "string" && file) {
        openFile(file, true);
      }
    } catch (e) {
      console.error("open file failed:", e);
    }
  }, [t, openFile]);

  const togglePanel = (id: PanelId) => setPanel((p) => (p === id ? null : id));

  // 状态栏按钮：隐藏/显示 活动栏 + 侧边栏（显示时若无激活面板则恢复文件资源管理器）
  const handleToggleLeftBar = useCallback(() => {
    setLeftVisible((v) => !v);
    if (panel === null) setPanel("explorer");
  }, [panel]);

  // 切换编辑模式（WYSIWYG ↔ 源码）
  const toggleMode = () => {
    const next: EditorMode = mode === "wysiwyg" ? "source" : "wysiwyg";
    setMode(next);
    editorRef.current?.setMode(next);
  };

  // 保存设置到 settings.json
  const saveSettings = (next: AppSettings) => {
    setSettings(next);
    invoke("write_settings", { settings: next }).catch(console.error);
  };

  // 切换"启用原生标题栏"（设置界面）：即时生效 + 持久化
  const toggleNativeTitleBar = () => {
    const next = { ...settings, nativeTitleBar: !settings.nativeTitleBar };
    saveSettings(next);
    getCurrentWindow()
      .setDecorations(next.nativeTitleBar)
      .catch((e) => console.error("setDecorations failed:", e));
  };

  // 切换界面语言（设置界面）
  const changeLanguage = (lang: string) => {
    saveSettings({ ...settings, language: lang });
    applyLanguage(lang);
  };

  // 切换行号显示（视图菜单）：作用于当前编辑模式
  const toggleShowLineNumbers = () => {
    const key = mode === "source" ? "showLineNumbersSource" : "showLineNumbersWysiwyg";
    saveSettings({ ...settings, [key]: !settings[key] });
  };

  // 切换"光标所在行显示源码"（设置界面）
  const toggleCursorLineSource = () => {
    saveSettings({ ...settings, cursorLineSource: !settings.cursorLineSource });
  };

  // 切换"高亮当前行"（视图菜单）：作用于当前编辑模式
  const toggleHighlightActiveLine = () => {
    const key = mode === "source" ? "highlightActiveLineSource" : "highlightActiveLineWysiwyg";
    saveSettings({ ...settings, [key]: !settings[key] });
  };

  // 设置面板：按模式设置行号
  const setShowLineNumbersForMode = (m: EditorMode, v: boolean) => {
    saveSettings({
      ...settings,
      [m === "source" ? "showLineNumbersSource" : "showLineNumbersWysiwyg"]: v,
    });
  };

  // 设置面板：按模式设置高亮当前行
  const setHighlightActiveLineForMode = (m: EditorMode, v: boolean) => {
    saveSettings({
      ...settings,
      [m === "source" ? "highlightActiveLineSource" : "highlightActiveLineWysiwyg"]: v,
    });
  };

  // 侧边栏拖拽结束 → 持久化宽度（§5.1 布局记忆）
  const handleSidebarWidthChange = useCallback((width: number) => {
    setSettings((prev) => {
      const next = { ...prev, sidebarWidth: width };
      invoke("write_settings", { settings: next }).catch(console.error);
      return next;
    });
  }, []);

  // 大纲点击跳转
  const jumpToHeading = useCallback((pos: number) => {
    editorRef.current?.setCursor(pos, true);
  }, []);

  // 当前光标所在章节（大纲高亮）
  const activeOutlineIndex = useMemo(() => {
    if (!cursor) return -1;
    let idx = -1;
    for (let i = 0; i < outline.length; i++) {
      if (outline[i].line <= cursor.line) idx = i;
      else break;
    }
    return idx;
  }, [outline, cursor]);

  // 菜单栏配置
  const menus: MenuDef[] = useMemo(
    () => [
      {
        id: "file",
        label: t("menu.file"),
        items: [
          {
            id: "new",
            label: t("menu.newFile"),
            shortcut: "Ctrl+N",
            onClick: () => void handleNewFile(),
          },
          { id: "openFile", label: t("menu.openFile"), shortcut: "Ctrl+O", onClick: () => void handleOpenFile() },
          { id: "openFolder", label: t("menu.openFolder"), shortcut: "Ctrl+K", onClick: () => void handleOpenFolder() },
          { separator: true },
          {
            id: "save",
            label: t("menu.save"),
            shortcut: "Ctrl+S",
            disabled: !selected,
            onClick: () => void handleSave(),
          },
          {
            id: "saveAs",
            label: t("menu.saveAs"),
            shortcut: "Ctrl+Shift+S",
            disabled: !selected,
            onClick: () => void handleSaveAs(),
          },
          { separator: true },
          {
            id: "close",
            label: t("menu.closeFile"),
            shortcut: "Ctrl+W",
            disabled: !selected,
            onClick: handleCloseFile,
          },
          { id: "quit", label: t("menu.quit"), shortcut: "Ctrl+Q", onClick: handleQuit },
        ],
      },
      {
        id: "edit",
        label: t("menu.edit"),
        items: [
          { id: "undo", label: t("menu.undo"), shortcut: "Ctrl+Z", onClick: () => editorRef.current?.undo() },
          { id: "redo", label: t("menu.redo"), shortcut: "Ctrl+Y", onClick: () => editorRef.current?.redo() },
          { separator: true },
          {
            id: "cut",
            label: t("menu.cut"),
            shortcut: "Ctrl+X",
            onClick: () => {
              const ed = editorRef.current;
              const sel = ed?.getSelection() ?? "";
              if (!sel) return;
              void writeText(sel).catch(console.error);
              ed?.replaceSelection("");
            },
          },
          {
            id: "copy",
            label: t("menu.copy"),
            shortcut: "Ctrl+C",
            onClick: () => {
              const sel = editorRef.current?.getSelection() ?? "";
              if (sel) void writeText(sel).catch(console.error);
            },
          },
          {
            id: "paste",
            label: t("menu.paste"),
            shortcut: "Ctrl+V",
            onClick: () => {
              void readText()
                .then((text) => {
                  if (text) editorRef.current?.replaceSelection(text);
                })
                .catch(console.error);
            },
          },
          { separator: true },
          { id: "selectAll", label: t("menu.selectAll"), shortcut: "Ctrl+A", onClick: () => editorRef.current?.selectAll() },
          { separator: true },
          { id: "find", label: t("menu.find"), shortcut: "Ctrl+F", onClick: () => editorRef.current?.find() },
          {
            id: "findInFiles",
            label: t("menu.findInFiles"),
            shortcut: "Ctrl+Shift+F",
            onClick: () => setPanel("search"),
          },
          { id: "replace", label: t("menu.replace"), shortcut: "Ctrl+H", onClick: () => editorRef.current?.findReplace() },
        ],
      },
      {
        id: "view",
        label: t("menu.view"),
        items: [
          { id: "mode", label: t("menu.toggleMode"), shortcut: "Ctrl+E", onClick: toggleMode },
          {
            id: "ln",
            label: t("menu.lineNumbers"),
            checked: mode === "source" ? settings.showLineNumbersSource : settings.showLineNumbersWysiwyg,
            onClick: toggleShowLineNumbers,
          },
          {
            id: "activeLine",
            label: t("menu.highlightActiveLine"),
            checked: mode === "source" ? settings.highlightActiveLineSource : settings.highlightActiveLineWysiwyg,
            onClick: toggleHighlightActiveLine,
          },
          { separator: true },
          {
            id: "sidebar",
            label: t("menu.toggleSidebar"),
            shortcut: "Ctrl+B",
            onClick: () => setPanel((p) => (p ? null : "explorer")),
          },
          { id: "outline", label: t("menu.showOutline"), shortcut: "Ctrl+Shift+O", onClick: () => setPanel("outline") },
          { id: "settings", label: t("menu.openSettings"), shortcut: "Ctrl+,", onClick: () => setPanel("settings") },
          { separator: true },
          {
            id: "devtools",
            label: t("menu.devtools"),
            shortcut: "Ctrl+Shift+I",
            onClick: () => void invoke("open_devtools"),
          },
        ],
      },
      {
        id: "theme",
        label: t("menu.theme"),
        items: [
          { id: "system", label: t("menu.system"), checked: theme === "system", onClick: () => setTheme("system") },
          { id: "light", label: t("menu.light"), checked: theme === "light", onClick: () => setTheme("light") },
          { id: "dark", label: t("menu.dark"), checked: theme === "dark", onClick: () => setTheme("dark") },
        ],
      },
      {
        id: "help",
        label: t("menu.help"),
        items: [
          { id: "welcome", label: t("menu.openWelcome"), onClick: handleCloseFile },
          { id: "about", label: t("menu.about"), onClick: () => setPanel("settings") },
          { id: "shortcuts", label: t("menu.shortcuts"), disabled: true },
        ],
      },
    ],
    [t, settings, selected, theme, mode, handleNewFile, handleSave, handleSaveAs, handleCloseFile, handleQuit, toggleMode, toggleShowLineNumbers, toggleHighlightActiveLine, handleOpenFile, handleOpenFolder],
  );

  // 全局快捷键（编辑器内部已处理的 Ctrl+S/Z/Y/A 与查找导航不在此重复）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        void handleNewFile();
      } else if (e.shiftKey && k === "s") {
        e.preventDefault();
        void handleSaveAs();
      } else if (k === "o") {
        e.preventDefault();
        void handleOpenFile();
      } else if (k === "k") {
        e.preventDefault();
        void handleOpenFolder();
      } else if (k === "w") {
        e.preventDefault();
        handleCloseFile();
      } else if (k === "b") {
        e.preventDefault();
        setPanel((p) => (p ? null : "explorer"));
      } else if (k === "e") {
        e.preventDefault();
        setMode((m) => {
          const next: EditorMode = m === "wysiwyg" ? "source" : "wysiwyg";
          editorRef.current?.setMode(next);
          return next;
        });
      } else if (k === "f") {
        // 编辑器内查找（VS Code 式；编辑器聚焦时由 CM 处理，这里兜底未聚焦场景）
        e.preventDefault();
        editorRef.current?.find();
      } else if (e.shiftKey && k === "f") {
        e.preventDefault();
        setPanel("search"); // 全局搜索面板
      } else if (k === "h") {
        e.preventDefault();
        editorRef.current?.findReplace();
      } else if (e.shiftKey && k === "o") {
        e.preventDefault();
        setPanel("outline");
      } else if (e.shiftKey && k === "i") {
        e.preventDefault();
        void invoke("open_devtools");
      } else if (k === ",") {
        e.preventDefault();
        setPanel("settings");
      } else if (k === "q") {
        e.preventDefault();
        handleQuit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="app">
      {!settings.nativeTitleBar && (
        <TitleBar documentName={selected ? `${basename(selected)}${dirty ? " ●" : ""}` : null} />
      )}
      <MenuBar menus={menus} />
      <div className="main">
        {leftVisible && <ActivityBar active={panel} onToggle={togglePanel} />}
        {leftVisible && panel && (
          <Sidebar
            panel={panel}
            rootDir={rootDir}
            selected={selected}
            onSelect={handleSelect}
            useNativeTitleBar={settings.nativeTitleBar}
            onToggleNativeTitleBar={toggleNativeTitleBar}
            showLineNumbersSource={settings.showLineNumbersSource}
            showLineNumbersWysiwyg={settings.showLineNumbersWysiwyg}
            onSetShowLineNumbers={setShowLineNumbersForMode}
            cursorLineSource={settings.cursorLineSource}
            onToggleCursorLineSource={toggleCursorLineSource}
            highlightActiveLineSource={settings.highlightActiveLineSource}
            highlightActiveLineWysiwyg={settings.highlightActiveLineWysiwyg}
            onSetHighlightActiveLine={setHighlightActiveLineForMode}
            language={settings.language}
            onChangeLanguage={changeLanguage}
            startupBehavior={settings.startupBehavior}
            onStartupBehaviorChange={(v) => saveSettings({ ...settings, startupBehavior: v })}
            width={settings.sidebarWidth}
            onWidthChange={handleSidebarWidthChange}
            outline={outline}
            activeOutlineIndex={activeOutlineIndex}
            onOutlineJump={jumpToHeading}
            treeRefreshKey={treeVersion}
            externalReload={treeExternalReload}
            onRefreshTree={handleRefreshTree}
            onOpenFolder={() => void handleOpenFolder()}
            onEntryRenamed={handleEntryRenamed}
            onEntryDeleted={handleEntryDeleted}
            onSearchOpen={handleSearchOpen}
          />
        )}
        <main className="content">
          <div className="editor-area">
            <div className="editor-pane">
              <div ref={editorHostRef} className={"code-editor" + (mode === "source" ? " source-mode" : "")} />
            </div>
          </div>
          {!selected && (
            <div className="welcome-overlay">
              <WelcomePage
                recent={settings.recent ?? []}
                onNewFile={() => void handleNewFile()}
                onOpenFile={() => void handleOpenFile()}
                onOpenFolder={() => void handleOpenFolder()}
                onOpenRecent={(path, isDir) => void handleOpenRecent(isDir ? "folder" : "file", path)}
                onRemoveRecent={removeRecent}
              />
            </div>
          )}
        </main>
      </div>
      <StatusBar
        selected={selected}
        mode={mode}
        cursor={cursor}
        charCount={charCount}
        leftBarVisible={leftVisible}
        onToggleLeftBar={handleToggleLeftBar}
        onToggleMode={toggleMode}
      />
    </div>
  );
}

export default App;
