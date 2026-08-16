// 内存文件系统 mock：模拟 Rust 侧 invoke（仅供无头 UI 测试）
interface MockEntry {
  name: string;
  is_dir: boolean;
  children?: Map<string, MockEntry>;
}

const root = new Map<string, MockEntry>();
function init() {
  root.clear();
  const mk = (path: string, is_dir: boolean) => {
    const parts = path.split("/").filter(Boolean);
    let cur = root;
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      if (last) cur.set(p, { name: p, is_dir, ...(is_dir ? { children: new Map() } : {}) });
      else {
        let d = cur.get(p);
        if (!d) {
          d = { name: p, is_dir: true, children: new Map() };
          cur.set(p, d);
        }
        cur = d.children!;
      }
    });
  };
  // 根目录 /ws 直接就是 root 映射
  mk("docs", true);
  mk("docs/readme.md", false);
  mk("docs/notes", true);
  mk("docs/notes/a.md", false);
  mk("docs/style.css", false);
  mk("docs/data.json", false);
  mk("test.txt", false);
  mk("app.js", false);
  mk("other.md", false);
  mk("config.yml", false);
  mk("photo.png", false);
}
init();

function lookup(path: string): { dir: Map<string, MockEntry>; name: string } | null {
  const parts = path.replace(/^\/ws/, "").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const d = cur.get(parts[i]);
    if (!d || !d.is_dir) return null;
    cur = d.children!;
  }
  return { dir: cur, name: parts[parts.length - 1] };
}

function resolveParent(path: string): Map<string, MockEntry> | null {
  const parts = path.replace(/^\/ws/, "").split("/").filter(Boolean);
  let cur = root;
  for (const p of parts) {
    const d = cur.get(p);
    if (!d || !d.is_dir) return null;
    cur = d.children!;
  }
  return cur;
}

function list(path: string): MockEntry[] {
  if (path === "/ws" || path === "/ws/") return Array.from(root.values());
  const found = lookup(path);
  if (!found) return [];
  const e = found.dir.get(found.name);
  if (!e || !e.children) return [];
  return Array.from(e.children.values());
}

// 测试用 convertFileSrc（Tauri 官方 asset URL；mock 环境无法真正加载，仅保证调用不崩）
export function convertFileSrc(filePath: string): string {
  return "http://asset.localhost/" + filePath.split(/[\\/]/).map(encodeURIComponent).join("/");
}

export async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {    case "read_settings": {
      // App 启动即加载 /ws 文件树（startupBehavior=lastDir），便于无头验证
      return {
        nativeTitleBar: false,
        language: "system",
        sidebarWidth: 240,
        showLineNumbersSource: true,
        showLineNumbersWysiwyg: false,
        cursorLineSource: true,
        highlightActiveLineSource: true,
        highlightActiveLineWysiwyg: false,
        startupBehavior: "lastDir",
        lastDir: "/ws",
        lastFile: null,
        recent: [],
        windowWidth: null,
        windowHeight: null,
        windowX: null,
        windowY: null,
      };
    }
    case "write_settings":
      return undefined;
    case "list_dir": {
      const entries = list(String(args.path));
      return entries
        .map((e) => ({ name: e.name, path: String(args.path).replace(/\/$/, "") + "/" + e.name, is_dir: e.is_dir }))
        .sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
    }
    case "file_meta": {
      const found = metaStore.get(String(args.path));
      return found ?? { modified: 0, size: 0 };
    }
    case "read_file": {
      // 固定返回含本地/外链/绝对路径图片与链接的文档
      return "# 测试\n\n![本地图](pic.png)\n\n[百度一下](https://www.baidu.com)\n\n[GitHub](https://github.com)";
    }
    case "search_files": {
      // 简化 mock：按文件名模拟匹配（每文件返回一条"匹配"）
      const q = String(args.query ?? "").toLowerCase();
      const cs = Boolean(args.caseSensitive);
      const out: { path: string; line: number; text: string; col: number; len: number }[] = [];
      const walk = (m: Map<string, MockEntry>, prefix: string) => {
        for (const e of m.values()) {
          const name = cs ? e.name : e.name.toLowerCase();
          if (!e.is_dir && name.includes(cs ? q : q.toLowerCase())) {
            out.push({ path: prefix + "/" + e.name, line: 1, text: e.name, col: 0, len: Math.max(1, q.length) });
          }
          if (e.is_dir && e.children) walk(e.children, prefix + "/" + e.name);
        }
      };
      walk(root, "/ws");
      return out;
    }
    case "create_entry": {
      const parentDir = resolveParent(String(args.parent));
      if (!parentDir) return Promise.reject("parent not found");
      const name = String(args.name);
      if (parentDir.has(name)) return Promise.reject("exists: " + name);
      parentDir.set(name, {
        name,
        is_dir: Boolean(args.isDir),
        ...(args.isDir ? { children: new Map() } : {}),
      });
      return undefined;
    }
    case "rename_entry": {
      const found = lookup(String(args.path));
      if (!found) return Promise.reject("not found");
      const e = found.dir.get(found.name);
      if (!e) return Promise.reject("not found");
      found.dir.delete(found.name);
      found.dir.set(String(args.newName), e);
      e.name = String(args.newName);
      return undefined;
    }
    case "delete_entry": {
      const found = lookup(String(args.path));
      if (!found) return Promise.reject("not found");
      found.dir.delete(found.name);
      return undefined;
    }
    default:
      return Promise.reject("unmocked command: " + cmd);
  }
}

export function __fsSnapshot(): string {
  const dump = (m: Map<string, MockEntry>, indent: string): string[] =>
    Array.from(m.values())
      .sort((a, b) => Number(b.is_dir) - Number(a.is_dir))
      .flatMap((e) => [
        indent + (e.is_dir ? "[d] " : "[f] ") + e.name,
        ...(e.children ? dump(e.children, indent + "  ") : []),
      ]);
  return dump(root, "").join("\n");
}

// ── 测试工具：模拟系统文件管理器中的外部变化 ──

/** 文件元信息存储（file_meta 返回，测试可改写模拟外部修改） */
const metaStore = new Map<string, { modified: number; size: number }>();

/** 改写某目录的条目列表（模拟外部新建/删除/重命名） */
export function __setDir(path: string, entries: { name: string; is_dir: boolean }[]): void {
  const parts = path.replace(/^\/ws/, "").split("/").filter(Boolean);
  let cur = root;
  for (const p of parts) {
    const d = cur.get(p);
    if (!d || !d.is_dir) return;
    cur = d.children!;
  }
  cur.clear();
  for (const e of entries) {
    cur.set(e.name, { name: e.name, is_dir: e.is_dir, ...(e.is_dir ? { children: new Map() } : {}) });
  }
}

/** 模拟某文件被外部修改（mtime 变化） */
export function __setMeta(path: string, modified: number, size = 1): void {
  metaStore.set(path, { modified, size });
}

/** 重置元信息 */
export function __resetMeta(): void {
  metaStore.clear();
}
