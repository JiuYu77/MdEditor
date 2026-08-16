/**
 * @mdeditor/md-core —— Markdown 解析 + 渲染核心库
 *
 * 设计约束（见需求文档 §6.1）：
 * - 纯逻辑，零 UI 框架依赖、零 Tauri 依赖，可在浏览器独立运行与测试
 * - 输出带语义化 class 的 HTML，样式由主题层（CSS 变量）注入
 */
import MarkdownIt from "markdown-it";

/** 解析选项 */
export interface ParseOptions {
  /** 是否启用 GFM（任务列表、表格、删除线等），默认 true */
  gfm?: boolean;
  /** 是否渲染 HTML 片段，默认 true（可配置关闭） */
  html?: boolean;
  /** 软换行是否渲染为 <br>，默认 false */
  breaks?: boolean;
}

/** 渲染选项 */
export interface RenderOptions extends ParseOptions {
  /** 是否启用代码高亮（highlight.js），默认 true */
  highlight?: boolean;
  /** 是否渲染数学公式（KaTeX），默认 false */
  math?: boolean;
  /** 是否渲染 Mermaid 图表，默认 false */
  mermaid?: boolean;
}

/** 文档大纲条目（供大纲面板使用） */
export interface Heading {
  level: number;
  text: string;
  id: string;
}

/** 解析结果 */
export interface Ast {
  /** 渲染后的 HTML 字符串 */
  html: string;
  /** 文档大纲（标题树） */
  headings: Heading[];
}

/** 渲染插件（markdown-it 插件注册机制，供自定义扩展使用） */
export interface Plugin {
  name: string;
  install(): void;
}

const _plugins = new Set<Plugin>();

function createRenderer(options: ParseOptions): MarkdownIt {
  return new MarkdownIt({
    html: options.html ?? true,
    breaks: options.breaks ?? false,
    linkify: true,
    typographer: true,
  });
}

/**
 * 解析 Markdown → Ast（渲染 HTML + 提取大纲标题）
 */
export function parse(mdText: string, options: ParseOptions = {}): Ast {
  const renderer = createRenderer(options);
  const env: Record<string, unknown> = {};
  const tokens = renderer.parse(mdText, env);

  // 提取大纲：heading_open 紧跟的 inline token 内容
  const headings: Heading[] = [];
  tokens.forEach((token, i) => {
    if (token.type === "heading_open") {
      const level = Number(token.tag.slice(1));
      const inline = tokens[i + 1];
      headings.push({
        level,
        text: inline ? inline.content : "",
        id: "",
      });
    }
  });

  return {
    html: renderer.renderer.render(tokens, renderer.options, env),
    headings,
  };
}

/** 渲染 Markdown → HTML 字符串 */
export function render(mdText: string, options: RenderOptions = {}): string {
  return parse(mdText, options).html;
}

/** 注册渲染插件（TODO: 接入 markdown-it.use 链） */
export function registerPlugin(plugin: Plugin): void {
  _plugins.add(plugin);
}

/** 已注册插件列表（只读） */
export function getPlugins(): Plugin[] {
  return [..._plugins];
}
