/**
 * 按文件扩展名返回 Font Awesome 图标类（文件树/其他文件列表用）。
 * 类名含前缀（fa-solid / fa-brands），可直接用于 <i className={...}>。
 */

/** 常见扩展名 → FA 图标类 */
const ICON_MAP: Record<string, string> = {
  // 文档
  md: "fa-brands fa-markdown",
  markdown: "fa-brands fa-markdown",
  mdx: "fa-brands fa-markdown",
  txt: "fa-solid fa-file-lines",
  log: "fa-solid fa-file-lines",
  // 代码
  js: "fa-brands fa-js",
  jsx: "fa-brands fa-js",
  mjs: "fa-brands fa-js",
  cjs: "fa-brands fa-js",
  ts: "fa-solid fa-file-code",
  tsx: "fa-solid fa-file-code",
  json: "fa-solid fa-file-json",
  html: "fa-brands fa-html5",
  htm: "fa-brands fa-html5",
  css: "fa-brands fa-css3",
  scss: "fa-brands fa-css3",
  less: "fa-brands fa-css3",
  py: "fa-brands fa-python",
  java: "fa-brands fa-java",
  rb: "fa-solid fa-gem",
  php: "fa-brands fa-php",
  rs: "fa-brands fa-rust",
  go: "fa-solid fa-code",
  c: "fa-solid fa-file-code",
  h: "fa-solid fa-file-code",
  cpp: "fa-solid fa-file-code",
  cs: "fa-solid fa-file-code",
  sh: "fa-solid fa-terminal",
  bash: "fa-solid fa-terminal",
  zsh: "fa-solid fa-terminal",
  bat: "fa-solid fa-terminal",
  ps1: "fa-solid fa-terminal",
  // 配置
  yml: "fa-solid fa-gear",
  yaml: "fa-solid fa-gear",
  toml: "fa-solid fa-gear",
  ini: "fa-solid fa-gear",
  cfg: "fa-solid fa-gear",
  conf: "fa-solid fa-gear",
  env: "fa-solid fa-gear",
  // 图片 / 媒体
  png: "fa-solid fa-file-image",
  jpg: "fa-solid fa-file-image",
  jpeg: "fa-solid fa-file-image",
  gif: "fa-solid fa-file-image",
  webp: "fa-solid fa-file-image",
  ico: "fa-solid fa-file-image",
  bmp: "fa-solid fa-file-image",
  svg: "fa-solid fa-file-image",
  mp3: "fa-solid fa-file-audio",
  wav: "fa-solid fa-file-audio",
  flac: "fa-solid fa-file-audio",
  ogg: "fa-solid fa-file-audio",
  mp4: "fa-solid fa-file-video",
  mkv: "fa-solid fa-file-video",
  avi: "fa-solid fa-file-video",
  webm: "fa-solid fa-file-video",
  mov: "fa-solid fa-file-video",
  // 办公
  pdf: "fa-solid fa-file-pdf",
  doc: "fa-solid fa-file-word",
  docx: "fa-solid fa-file-word",
  xls: "fa-solid fa-file-excel",
  xlsx: "fa-solid fa-file-excel",
  csv: "fa-solid fa-file-csv",
  ppt: "fa-solid fa-file-powerpoint",
  pptx: "fa-solid fa-file-powerpoint",
  // 压缩包
  zip: "fa-solid fa-file-zipper",
  rar: "fa-solid fa-file-zipper",
  "7z": "fa-solid fa-file-zipper",
  tar: "fa-solid fa-file-zipper",
  gz: "fa-solid fa-file-zipper",
  // 数据
  sql: "fa-solid fa-database",
  db: "fa-solid fa-database",
  sqlite: "fa-solid fa-database",
  sqlite3: "fa-solid fa-database",
};

import { basename } from "./utils/path";

/** 按文件名返回图标类（默认通用文件图标） */
export function fileIconClass(name: string): string {
  const base = basename(name);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  return ICON_MAP[ext] ?? "fa-solid fa-file";
}
