/**
 * WYSIWYG 自定义 Widget（@mdeditor/md-editor 内部）
 * 列表圆点 / 有序序号 / 任务复选框 / 分割线 —— 替换对应语法标记的 DOM 元素
 */
import { WidgetType } from "@codemirror/view";

/** 列表项目符号（替换 "- " 标记） */
export class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "md-bullet";
    span.textContent = "•";
    return span;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** 有序列表序号（保留 "1." 数字并加样式） */
export class OrderedItemWidget extends WidgetType {
  constructor(private text: string) {
    super();
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "md-list-order";
    span.textContent = this.text;
    return span;
  }
  eq(other: OrderedItemWidget): boolean {
    return other.text === this.text;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** 任务列表复选框（- [ ] 未勾 / - [x] 已勾） */
export class TaskCheckboxWidget extends WidgetType {
  constructor(private checked: boolean) {
    super();
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "md-task-checkbox" + (this.checked ? " checked" : "");
    return span;
  }
  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * 链接（Markdown [text](url) 整段替换为链接 span）。
 * 不用拆分的标记 replace 隐藏 [ ] 与 (url)：行首/文档开头的单字符 replace 在
 * CM 渲染中会退化为「插入空 widget 而不跳过文本」（[ 残留，见用户反馈），
 * 与图片一致整段替换最可靠。
 */
export class LinkWidget extends WidgetType {
  constructor(
    private label: string,
    private url: string,
  ) {
    super();
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "md-link";
    span.dataset.url = this.url;
    // 完整源码（[text](url)）：鼠标悬停时显示（Typora 式提示），点击仍可打开
    span.dataset.source = `[${this.label}](${this.url})`;
    span.textContent = this.label;
    return span;
  }
  eq(other: LinkWidget): boolean {
    return other.label === this.label && other.url === this.url;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/* ── 图片 URL 解析（宿主注入：本地/相对路径 → 可加载 URL，如 Tauri asset 协议） ── */

/**
 * 归一化本地路径：解析 `.` 与 `..` 段（支持 Windows 盘符 / UNC / 斜杠根），返回绝对路径。
 * 例：`D:\a\b\..\c.png` → `D:\a\c.png`；`..` 不会越出根（盘符根/UNC 根之上则忽略）。
 */
export function normalizeLocalPath(p: string): string {
  let prefix = "";
  let rest = p;
  const drive = /^([a-zA-Z]:[\\/])/.exec(p);
  if (drive) {
    prefix = drive[1];
    rest = p.slice(drive[1].length);
  } else if (p.startsWith("\\\\")) {
    prefix = "\\\\";
    rest = p.slice(2);
  } else if (p.startsWith("/")) {
    prefix = "/";
    rest = p.slice(1);
  }
  const sep = p.includes("\\") ? "\\" : "/";
  const parts: string[] = [];
  for (const seg of rest.split(/[\\/]+/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 0) parts.pop(); // 不越出根
      continue;
    }
    parts.push(seg);
  }
  return prefix + parts.join(sep);
}

/**
 * 默认图片 URL 解析（框架无关纯函数，可独立用于任何 Web 环境）：
 * - 外链 http(s) / data / asset / file / blob：原样返回
 * - 本地绝对路径（盘符/UNC/斜杠开头）：原样返回
 * - 相对路径：若提供 baseDir（当前文档目录），纯字符串拼为绝对路径（归一化 `..`）并返回；否则原样
 * 宿主（如 Tauri 壳）可用 setImageUrlResolver 覆盖为 asset 协议版本。
 */
export function defaultImageUrlResolver(raw: string, baseDir?: string | null): string {
  if (/^(https?:|data:|asset:|file:|blob:)/i.test(raw)) return raw;
  if (baseDir && !/^([a-zA-Z]:[\\/]|\\\\|[\\/])/.test(raw)) {
    const sep = baseDir.includes("\\") ? "\\" : "/";
    return normalizeLocalPath(baseDir.replace(/[\\/]+$/, "") + sep + raw);
  }
  return raw;
}

/**
 * Asset 协议图片 URL 解析（供外部/宿主使用，如 Tauri 壳）。
 * 与 defaultImageUrlResolver 的区别：本地路径（绝对或相对+baseDir 拼出的绝对路径）
 * 会转换为 Tauri asset 协议 URL —— `http://asset.localhost/<整体编码>`，
 * 与官方 convertFileSrc 输出格式一致（需宿主启用 assetProtocol 才能加载）。
 * - 外链 http(s) / data / asset / file / blob：原样返回
 * - 本地绝对路径（盘符/UNC/斜杠开头）：→ asset URL
 * - 相对路径 + baseDir：先拼绝对再转 asset URL；无 baseDir 时原样返回
 * 拼出的路径会先归一化 `.`/`..` 段（Tauri asset 协议拒绝含 `..` 的路径，防目录穿越）。
 */
export function assetImageUrlResolver(raw: string, baseDir?: string | null): string {
  if (/^(https?:|data:|asset:|file:|blob:)/i.test(raw)) return raw;
  let abs = raw;
  if (!/^([a-zA-Z]:[\\/]|\\\\|[\\/])/.test(raw)) {
    if (!baseDir) return raw;
    const sep = baseDir.includes("\\") ? "\\" : "/";
    abs = baseDir.replace(/[\\/]+$/, "") + sep + raw;
  }
  abs = normalizeLocalPath(abs);
  // 整体编码（反斜杠 → %5C、盘符冒号 → %3A、中文 → %XX），与 Tauri convertFileSrc 一致
  return "http://asset.localhost/" + encodeURIComponent(abs);
}

let imageUrlResolver: ((url: string) => string) | null = null;

/** 注册图片 URL 解析函数（createEditor 时注入；单实例应用，多实例时后注册覆盖） */
export function setImageUrlResolver(resolve: ((url: string) => string) | null): void {
  imageUrlResolver = resolve;
}

/** 解析图片 URL（未注入时使用框架无关的默认解析：外链直通、相对路径按原样） */
function resolveImageUrl(url: string): string {
  return imageUrlResolver ? imageUrlResolver(url) : defaultImageUrlResolver(url);
}

/** 图片（Markdown ![alt](url) 替换为 <img>；加载失败显示 [alt] 提示，主流实现同款）
 * 提供 from/to（文档区间），点击图片时编辑器据此打开源码编辑覆盖层（见 index.ts）。 */
export class ImageWidget extends WidgetType {
  constructor(
    private url: string,
    private alt: string,
    private from: number,
    private to: number,
  ) {
    super();
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "md-image-wrap";
    const img = document.createElement("img");
    img.className = "md-image";
    img.src = resolveImageUrl(this.url);
    img.alt = this.alt;
    img.draggable = false;
    // 记录文档区间，供点击时定位源码编辑覆盖层
    img.dataset.from = String(this.from);
    img.dataset.to = String(this.to);
    img.onerror = () => {
      // 加载失败：默认显示 [alt] 文字（可点击，点击打开源码编辑覆盖层，见 index.ts）
      span.className = "md-image-wrap md-image-error";
      span.textContent = `[${this.alt}]`;
      span.style.cursor = "pointer";
      // 记录文档区间，供点击时定位源码编辑覆盖层
      span.dataset.from = String(this.from);
      span.dataset.to = String(this.to);
    };
    span.appendChild(img);
    return span;
  }
  eq(other: ImageWidget): boolean {
    // 位置也参与比较：文档偏移变化时重建 widget，确保 img.dataset.from/to 与当前文档一致
    return other.url === this.url && other.alt === this.alt && other.from === this.from && other.to === this.to;
  }
  ignoreEvent(): boolean {
    return false;
  }
}
