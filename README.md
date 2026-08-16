# MdEditor —— 极简跨平台 Markdown 编辑器

取 Typora 的沉浸写作体验与 VS Code 的功能组织之长：**所见即所得（WYSIWYG）实时渲染**为核心，融入**左侧活动栏 + 侧边栏**（文件树 / 全局搜索 / 大纲 / 设置），支持主题切换、自绘标题栏与无边框窗口。

> 完整需求见 [docs/需求说明书.md](docs/需求说明书.md)（PRD v1.15，含需求追踪矩阵）。

---

## ✨ 功能特性

### 编辑器核心（Typora 式写作体验）
- **WYSIWYG 实时渲染**：输入即渲染，光标实时跟随（CodeMirror 6 Live Preview）
- **源码模式**：一键切换（`Ctrl+E`），语法高亮、标题按级别配色
- **GFM 语法**：标题 H1–H6 / 粗体 / 斜体 / 删除线 / 行内代码 / 列表 / 任务列表 / 表格 / 引用 / 分割线 / 图片 / 链接 / 代码块
- **表格（进阶）**：Typora 式工具条（对齐快捷按钮 + 插入/删除行列 + 复制/删除表格）、列宽按内容自适应与窄屏压缩换行、首尾空格渲染隐藏、单元格点击确定性定位
- **代码块**：多语言高亮、折叠、语言切换弹层、一键复制、闭合行行号隐藏
- **链接**：渲染 + 点击浏览器打开 + 悬停显示源码
- **图片**：本地/相对路径（Tauri asset 协议）、加载失败显示 `[alt]` 占位
- **查找/替换**：`Ctrl+F` 编辑器内查找（区分大小写 / 正则 / 整个单词）、`Ctrl+Shift+F` 全局搜索、`Ctrl+H` 替换
- **编辑体验**：列表回车续行、任务复选框点击切换、光标行源码显示、当前行高亮（按模式独立设置）
- **排版**：内容区限宽 860px 居中（Typora 式）、行高/表格行高优化

### 左侧功能栏（VS Code 式）
- **活动栏**：文件资源管理器 / 搜索 / 大纲 / 扩展（预留）/ 设置
- **文件树**：新建 / 重命名 / 删除（递归确认）/ 右键菜单（复制路径 / 绝对路径）/ 目录懒加载与外部变更轮询
- **全局搜索**：工作区全文搜索（md/markdown/txt），区分大小写 / 整个单词，结果按文件分组，点击跳转
- **大纲**：按标题层级生成，点击跳转、随光标高亮
- **侧边栏**：宽度拖拽、收起/展开（`Ctrl+B`）

### 主题与窗口
- **内置主题**：浅色 / 深色 / 跟随系统（即时切换）
- **标题栏**：原生 / 自绘两种模式（自绘含应用图标、文档名、未保存 ● 标记、窗口控制按钮）
- **无边框窗口**：拖拽移动、最小化/最大化/关闭
- **窗口记忆**：位置、尺寸（最小 640×480 校验）、侧边栏宽度、启动行为（欢迎页 / 上次目录 / 上次文件）

### 其他
- **最近文件**：文件/文件夹统一时间排序（欢迎页 Recent 区）
- **未命名缓冲区**：`Ctrl+N` 新建文件先编辑、保存时才选择位置（VS Code 式）
- **i18n**：简体中文 / English，跟随系统或手动切换，即时生效
- **数据存储**：`settings.json`（应用数据目录），支持 `MDEDITOR_HOME` 环境变量覆盖（便携模式）
- **保存兜底**：保存前自动规范化损坏的表格结构（正常表格逐字节不变）

---

## 🛠 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | [Tauri 2](https://tauri.app/)（Rust 内核） |
| 前端 | React 19 + TypeScript + Vite |
| 编辑器内核 | [CodeMirror 6](https://codemirror.net/)（WYSIWYG = Live Preview 装饰 + 实时样式） |
| 编辑器库 | `@mdeditor/md-editor`（Monorepo 独立封装，零 Tauri 依赖） |
| 国际化 | i18next / react-i18next |
| 图标 | Font Awesome |

## 📁 项目结构

```
MdEditor/
├── src/                    # Tauri 壳前端（界面编排）
│   ├── App.tsx             # 主应用（文件/设置/主题/快捷键编排）
│   ├── components/         # 活动栏/侧边栏/文件树/菜单/标题栏/状态栏/欢迎页/搜索
│   ├── utils/              # 路径等工具
│   ├── locales/            # i18n（zh-CN / en-US）
│   └── normalizeTables.ts  # 表格保存前规范化
├── src-tauri/              # Rust 壳（文件系统命令 / 设置持久化 / 窗口）
│   └── icons/              # 全套应用图标（ico/icns/png）
├── packages/
│   └── md-editor/          # 编辑器库（Markdown 能力独立封装）
│       └── src/
│           ├── index.ts    # createEditor 实例 API
│           └── wysiwyg/    # WYSIWYG 装饰/表格/代码块/剪贴板/弹层等
├── docs/
│   └── 需求说明书.md       # 产品需求文档（PRD v1.15）
├── repro/                  # 无头回归测试（puppeteer + vite）
└── design/                 # 应用图标设计源文件（SVG/PNG）
```

## 🚀 开发

### 环境要求

- [Node.js](https://nodejs.org/) 18+（含 npm）
- [Rust](https://rustup.rs/)（stable，含 Cargo）
- 平台依赖：Windows 无需额外依赖；Linux 需 `libwebkit2gtk-4.1-dev` 等（见 Tauri 文档）

### 安装与运行

```bash
npm install          # 安装依赖（含 workspaces）
npm run tauri dev    # 启动开发（前端热更新 + Rust 增量编译）
```

前端独立调试（浏览器，需 mock 数据）：`npm run dev`。

### 构建

```bash
npm run build          # 前端构建（tsc + vite）
npm run tauri build    # 打包安装包（产物在 src-tauri/target/release/bundle/）
```

- **Windows**：NSIS/MSI 安装包
- **macOS**：DMG + .app（需在 macOS 上构建）
- **Linux**：AppImage / deb / rpm

> macOS 安装包只能在 macOS 上打包（Tauri 不支持 Windows → macOS 交叉编译）；可用 GitHub Actions macOS runner 自动构建（按需创建 `.github/workflows/release.yml`，参考 `tauri-action`）。

### 测试

无头回归测试位于 `repro/`（puppeteer + Edge 驱动，验证表格渲染/操作、点击定位、查找面板、全局搜索等）：

```bash
# 启动 vite（默认端口 1520；全局搜索用 mock 配置 5174）
npx vite --port 1520 --strictPort

# 运行单个测试（默认连 http://localhost:1520/repro/test9.html）
node repro/test14.mjs        # 表格操作回归
node repro/test34.mjs        # 编辑器查找面板
node repro/test35.mjs        # 全局搜索面板（需 mock: npx vite --config repro/vite.mock.config.ts --port 5174）

# 自定义目标
$env:REPRO_URL="http://localhost:5174/repro/app-test.html"; node repro/test35.mjs
```

## ⌨️ 快捷键

| 功能 | 快捷键 |
| --- | --- |
| 新建文件 | `Ctrl+N` |
| 打开文件 / 文件夹 | `Ctrl+O` / `Ctrl+K` |
| 保存 / 另存为 | `Ctrl+S` / `Ctrl+Shift+S` |
| 关闭文件 | `Ctrl+W` |
| 切换编辑模式（WYSIWYG ⇄ 源码） | `Ctrl+E` |
| 查找 / 替换 | `Ctrl+F` / `Ctrl+H` |
| 全局搜索 | `Ctrl+Shift+F` |
| 切换侧边栏 | `Ctrl+B` |
| 显示大纲 | `Ctrl+Shift+O` |
| 打开设置 | `Ctrl+,` |
| 开发者工具 | `Ctrl+Shift+I` |
| 退出 | `Ctrl+Q` |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` |

## 📄 文档

- [产品需求说明书（PRD）](docs/需求说明书.md)

## 📦 应用图标

图标由 `design/icon.svg` 设计生成（蓝渐变圆角方块 + 白色 **Md** + 暖黄编辑光标），通过 `npx tauri icon design/icon-1024.png` 生成全套（`src-tauri/icons/`）。

## 📝 License

私有项目（内部使用）。
