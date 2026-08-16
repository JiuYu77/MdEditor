// MdEditor Tauri 壳 —— 文件系统 + 设置持久化 commands
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;

/// 最近打开条目（欢迎页历史：文件与文件夹统一按时间排序，新→旧）
#[derive(Serialize, Deserialize, Clone)]
struct RecentItem {
    path: String,
    #[serde(rename = "isDir")]
    is_dir: bool,
    /// 打开时间戳（毫秒）；旧数据迁移时用序号近似
    #[serde(default)]
    time: u64,
}

/// 文件系统条目（供前端文件树渲染）
#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// 全文搜索结果条目（一行一个匹配）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchMatch {
    path: String,
    /// 匹配行号（1-based）
    line: usize,
    /// 匹配行文本（超长截断，前端显示）
    text: String,
    /// 匹配起点在行内的字符列（0-based）
    col: usize,
    /// 匹配长度（高亮用）
    len: usize,
}

/// 跳过这些目录（依赖/版本库/构建产物/应用数据）
fn is_ignored_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | ".svn" | "node_modules" | "target" | "dist" | "out" | ".mdeditor" | ".idea" | ".vscode"
    )
}

/// 是否可搜索的文本文件（Markdown / 纯文本）
fn is_searchable_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".txt")
}

/// 在目录中递归搜索文件内容（VS Code 式全局搜索；限定 md/markdown/txt，
/// 跳过隐藏目录与构建产物，限制单文件大小与总结果数防卡顿）
#[tauri::command]
fn search_files(dir: String, query: String, case_sensitive: bool, whole_word: bool) -> Result<Vec<SearchMatch>, String> {
    const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024; // 单文件 2MB 上限
    const MAX_RESULTS: usize = 2000;
    const MAX_TEXT_LEN: usize = 240; // 匹配行文本截断长度
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let needle = if case_sensitive { q.clone() } else { q.to_lowercase() };

    let mut out: Vec<SearchMatch> = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = vec![std::path::PathBuf::from(&dir)];
    while let Some(cur) = stack.pop() {
        if out.len() >= MAX_RESULTS {
            break;
        }
        let entries = match fs::read_dir(&cur) {
            Ok(e) => e,
            Err(_) => continue, // 权限/IO 错误跳过
        };
        for entry in entries.flatten() {
            let p = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue; // 隐藏条目
            }
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                if !is_ignored_dir(&name) {
                    stack.push(p);
                }
                continue;
            }
            if !is_searchable_file(&name) {
                continue;
            }
            let meta = match fs::metadata(&p) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.len() > MAX_FILE_BYTES {
                continue;
            }
            let content = match fs::read_to_string(&p) {
                Ok(c) => c,
                Err(_) => continue, // 非 UTF-8 等跳过
            };
            let path_str = p.to_string_lossy().to_string();
            for (idx, raw_line) in content.lines().enumerate() {
                let hay = if case_sensitive { raw_line.to_string() } else { raw_line.to_lowercase() };
                let mut search_from = 0;
                while out.len() < MAX_RESULTS {
                    let Some(rel) = hay[search_from..].find(&needle) else { break };
                    let col = search_from + rel;
                    // 整个单词：匹配前后都不是字母/数字/下划线
                    if whole_word {
                        let before_ok = col == 0 || !hay[..col].chars().last().unwrap().is_alphanumeric();
                        let after = &hay[col + needle.len()..];
                        let after_ok = after.is_empty() || !after.chars().next().unwrap().is_alphanumeric();
                        if !before_ok || !after_ok {
                            search_from = col + needle.len();
                            continue;
                        }
                    }
                    let text: String = raw_line.chars().take(MAX_TEXT_LEN).collect();
                    // col 为字节索引，转字符列（前端按字符展示）
                    let char_col = raw_line[..col.min(raw_line.len())].chars().count();
                    let len = q.chars().count();
                    out.push(SearchMatch { path: path_str.clone(), line: idx + 1, text, col: char_col, len });
                    search_from = col + needle.len();
                }
            }
        }
    }
    Ok(out)
}

/// 应用设置（对应需求文档 §3.5.3 的 settings.json）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Settings {
    /// 是否启用原生标题栏（false = 自绘标题栏）
    #[serde(default)]
    native_title_bar: bool,
    /// 界面语言：system | zh-CN | en-US
    #[serde(default = "default_language")]
    language: String,
    /// 侧边栏宽度（px），默认 240（§5.1 布局记忆）
    #[serde(default = "default_sidebar_width")]
    sidebar_width: u32,
    /// 显示行号（源码模式），默认 true
    #[serde(default = "default_true")]
    show_line_numbers_source: bool,
    /// 显示行号（所见即所得模式），默认 false
    #[serde(default)]
    show_line_numbers_wysiwyg: bool,
    /// 光标所在行显示 Markdown 源码（Obsidian/Typora 式），默认 true
    #[serde(default = "default_true")]
    cursor_line_source: bool,
    /// 高亮当前行（源码模式），默认 true
    #[serde(default = "default_true")]
    highlight_active_line_source: bool,
    /// 高亮当前行（所见即所得模式），默认 false
    #[serde(default)]
    highlight_active_line_wysiwyg: bool,
    /// 启动行为：welcome（新窗口/欢迎页）| last_dir（上次打开的目录）| last_file（上次打开的文件）
    #[serde(default = "default_startup_behavior")]
    startup_behavior: String,
    /// 上次打开的目录（供 last_dir 启动行为使用）
    #[serde(default)]
    last_dir: Option<String>,
    /// 上次打开的文件（供 last_file 启动行为使用）
    #[serde(default)]
    last_file: Option<String>,
    /// 最近打开（新→旧，文件与文件夹统一按时间排序）
    #[serde(default)]
    recent: Vec<RecentItem>,
    /// 上次窗口大小（宽，逻辑像素；None 用 tauri.conf.json 默认值）
    #[serde(default)]
    window_width: Option<u32>,
    /// 上次窗口大小（高，逻辑像素）
    #[serde(default)]
    window_height: Option<u32>,
    /// 上次窗口位置（x，逻辑像素；多显示器可为负值）
    #[serde(default)]
    window_x: Option<i32>,
    /// 上次窗口位置（y，逻辑像素）
    #[serde(default)]
    window_y: Option<i32>,
}

fn default_language() -> String {
    "system".to_string()
}

fn default_sidebar_width() -> u32 {
    240
}

fn default_true() -> bool {
    true
}

fn default_startup_behavior() -> String {
    "welcome".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            native_title_bar: false,
            language: default_language(),
            sidebar_width: default_sidebar_width(),
            show_line_numbers_source: default_true(),
            show_line_numbers_wysiwyg: false,
            cursor_line_source: default_true(),
            highlight_active_line_source: default_true(),
            highlight_active_line_wysiwyg: false,
            startup_behavior: default_startup_behavior(),
            last_dir: None,
            last_file: None,
            recent: Vec::new(),
            window_width: None,
            window_height: None,
            window_x: None,
            window_y: None,
        }
    }
}

/// 数据根目录（需求文档 §3.5.3）：配置/缓存/日志/主题统一放到一个目录
/// 1. 优先 `MDEDITOR_HOME` 环境变量（支持相对路径 → 相对可执行文件目录，即便携模式）
/// 2. 回退平台默认目录（`app_config_dir()`：Windows %APPDATA%\{identifier} 等）
fn data_home(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(dir) = std::env::var("MDEDITOR_HOME") {
        let p = std::path::PathBuf::from(&dir);
        let resolved = if p.is_absolute() {
            p
        } else {
            // 相对路径 → 相对可执行文件所在目录（便携模式：解压即用、不写系统目录）
            std::env::current_exe()
                .ok()
                .and_then(|e| e.parent().map(|d| d.join(&p)))
                .unwrap_or(p)
        };
        return Ok(resolved);
    }
    app.path().app_config_dir().map_err(|e| e.to_string())
}

/// settings.json 路径（位于数据根目录下）
fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(data_home(app)?.join("settings.json"))
}

/// 读取设置（不存在或损坏时回退默认）
#[tauri::command]
fn read_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("settings.json 解析失败: {e}"))
}

/// 写入设置（原子写：先写临时文件再重命名，避免中途断电损坏）
#[tauri::command]
fn write_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// 返回用户主目录（Windows: USERPROFILE；macOS/Linux: HOME）
#[tauri::command]
fn home_dir() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string())
}

/// 列出目录内容（隐藏文件/目录默认过滤，目录优先排序）
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut items: Vec<FileEntry> = entries
        .flatten()
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .map(|e| {
            let p = e.path();
            FileEntry {
                name: e.file_name().to_string_lossy().to_string(),
                path: p.to_string_lossy().to_string(),
                is_dir: p.is_dir(),
            }
        })
        .collect();
    // 目录在前，名称不区分大小写排序
    items.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(items)
}

/// 读取文本文件内容（限制大小，防超大文件卡死；100MB 支持 20 万行级文档）
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 100 * 1024 * 1024 {
        return Err("file too large ( > 100MB )".into());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// 写入文本文件（保存，原子写：先写临时文件再重命名）
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    let tmp = p.with_extension("md.tmp");
    fs::write(&tmp, &content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
    Ok(())
}

/// 创建文件/文件夹（parent 为父目录路径，name 为新条目名）
#[tauri::command]
fn create_entry(parent: String, name: String, is_dir: bool) -> Result<(), String> {
    if name.is_empty() || name.contains(['/', '\\']) {
        return Err("invalid entry name".into());
    }
    let p = std::path::PathBuf::from(&parent).join(&name);
    if p.exists() {
        return Err(format!("已存在同名条目: {name}"));
    }
    if is_dir {
        fs::create_dir(&p).map_err(|e| e.to_string())
    } else {
        fs::write(&p, "").map_err(|e| e.to_string())
    }
}

/// 重命名文件/文件夹（新名仅含名称，不含路径）
#[tauri::command]
fn rename_entry(path: String, new_name: String) -> Result<(), String> {
    if new_name.is_empty() || new_name.contains(['/', '\\']) {
        return Err("invalid entry name".into());
    }
    let p = std::path::PathBuf::from(&path);
    let parent = p.parent().ok_or("invalid path")?;
    let new_path = parent.join(&new_name);
    if new_path.exists() {
        return Err(format!("已存在同名条目: {new_name}"));
    }
    fs::rename(&p, &new_path).map_err(|e| e.to_string())
}

/// 删除文件/文件夹（文件夹递归删除，前端需二次确认）
#[tauri::command]
fn delete_entry(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

/// 文件元信息（外部修改检测用：修改时间毫秒 + 大小）
#[derive(serde::Serialize)]
struct FileMeta {
    modified: u64,
    size: u64,
}

/// 读取文件元信息（mtime 毫秒 + 字节数），用于检测文件被外部修改
#[tauri::command]
fn file_meta(path: String) -> Result<FileMeta, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileMeta { modified, size: meta.len() })
}

/// 路径是否存在（欢迎页最近记录点击前校验：文件/文件夹被删除时提示移除记录）
#[tauri::command]
fn path_exists(path: String) -> bool {
    fs::metadata(path).is_ok()
}

/// 打开开发者工具（菜单栏-视图-开发者工具；右键菜单已禁用，不再暴露网页检查选项）
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // 恢复上次窗口大小与位置（settings.json 的 windowWidth/Height/X/Y，逻辑像素）。
            // 窗口以 visible:false 创建（tauri.conf.json），这里先应用尺寸/位置再 show，
            // 避免启动时先以默认尺寸闪现再跳变到记录值。
            let win = app.get_webview_window("main");
            if let Ok(path) = settings_path(app.handle()) {
                if let Ok(text) = fs::read_to_string(&path) {
                    if let Ok(s) = serde_json::from_str::<Settings>(&text) {
                        // 恢复窗口尺寸：校验最小值（对应 tauri.conf minWidth/minHeight 640x480）。
                        // 异常记录（如窗口被拖到极矮、最大化过渡值 33px 高）会导致启动只剩
                        // 标题栏，此时跳过恢复使用默认尺寸。
                        if let (Some(w), Some(h)) = (s.window_width, s.window_height) {
                            if w >= 640 && h >= 480 {
                                if let Some(win) = &win {
                                    let _ = win.set_size(tauri::LogicalSize::new(w as f64, h as f64));
                                }
                            }
                        }
                        // 位置恢复 + 屏幕可见性校验：显示器布局变化（如副屏拔掉）后
                        // 位置可能落到屏幕外，此时跳过恢复，交给系统默认摆放
                        if let (Some(x), Some(y)) = (s.window_x, s.window_y) {
                            if let Some(win) = &win {
                                let scale = win.scale_factor().unwrap_or(1.0);
                                let px = (x as f64 * scale).round() as i32;
                                let py = (y as f64 * scale).round() as i32;
                                let (pw, ph) = win
                                    .outer_size()
                                    .map(|sz| (sz.width as i32, sz.height as i32))
                                    .unwrap_or((0, 0));
                                let on_screen = app
                                    .available_monitors()
                                    .map(|ms| {
                                        ms.iter().any(|m| {
                                            let p = m.position();
                                            let s = m.size();
                                            let (mx, my) = (p.x, p.y);
                                            let (mw, mh) = (s.width as i32, s.height as i32);
                                            // 窗口矩形与屏幕矩形相交（允许部分可见）
                                            (px < mx + mw) && (px + pw > mx) && (py < my + mh) && (py + ph > my)
                                        })
                                    })
                                    .unwrap_or(true);
                                if on_screen {
                                    let _ = win.set_position(tauri::PhysicalPosition::new(px, py));
                                }
                            }
                        }
                    }
                }
            }
            if let Some(win) = win {
                let _ = win.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_settings,
            write_settings,
            home_dir,
            list_dir,
            read_file,
            write_file,
            file_meta,
            path_exists,
            create_entry,
            rename_entry,
            delete_entry,
            search_files,
            open_devtools
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
