/**
 * @mdeditor/md-sync —— 同步协议客户端（BYOS，见需求文档 §3.5.5）
 *
 * 设计要点：
 * - WebDAV 为主（服务端无需专用软件：Nextcloud/群晖/坚果云/自建 nginx）
 * - 凭据不落配置：仅存 credentialKey 引用，真实凭据在系统密钥链（SY-06）
 * - 可选：SFTP / Git / 自定义命令后端（P2）
 */

/** 同步协议 */
export type SyncProtocol = 'webdav' | 'sftp' | 'git' | 'command';

/** 同步配置 */
export interface SyncConfig {
  protocol: SyncProtocol;
  /** 服务器地址（WebDAV 端点 / SFTP host 等） */
  url: string;
  /** 本地目录 → 服务器目录映射 */
  localPath: string;
  remotePath: string;
  /** 凭据引用键（真实凭据存系统密钥链） */
  credentialKey?: string;
  /** 排除规则（如 .git/、node_modules/） */
  exclude?: string[];
}

/** 同步结果 */
export interface SyncResult {
  ok: boolean;
  error?: string;
  /** 传输文件数 */
  transferred?: number;
}

/**
 * 推送（本地 → 服务器）
 * TODO: WebDAV 协议实现（或对接 Rust 侧能力，见需求文档 §3.5.5 实现说明）
 */
export function syncPush(config: SyncConfig): Promise<SyncResult> {
  void config;
  throw new Error('md-sync 尚未实现：骨架占位');
}

/** 拉取（服务器 → 本地）TODO */
export function syncPull(config: SyncConfig): Promise<SyncResult> {
  void config;
  throw new Error('md-sync 尚未实现：骨架占位');
}
