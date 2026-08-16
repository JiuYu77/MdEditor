import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Monorepo：workspace 包（packages/*）作为源码直接处理，不预构建缓存，
  // 否则修改 packages/md-editor 等不会触发热更新（node_modules 符号链接不被 watch）
  optimizeDeps: {
    exclude: [
      "@mdeditor/md-core",
      "@mdeditor/md-editor",
      "@mdeditor/md-export",
      "@mdeditor/md-sync",
    ],
    // 运行时依赖预构建提前到服务器启动时完成，避免首屏请求才按需打包
    // （react + CodeMirror 全家桶 + Tauri 插件一起预构建需要数秒，是启动白屏的主因）
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react-i18next",
      "i18next",
      "@tauri-apps/api/core",
      "@tauri-apps/api/window",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-clipboard-manager",
      "@tauri-apps/plugin-opener",
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/commands",
      "@codemirror/language",
      "@codemirror/lang-markdown",
      "@codemirror/lang-json",
      "@codemirror/legacy-modes/mode/clike",
      "@codemirror/legacy-modes/mode/javascript",
      "@codemirror/legacy-modes/mode/python",
      "@codemirror/legacy-modes/mode/rust",
      "@codemirror/legacy-modes/mode/go",
      "@codemirror/legacy-modes/mode/css",
      "@codemirror/legacy-modes/mode/sql",
      "@codemirror/legacy-modes/mode/shell",
      "@codemirror/legacy-modes/mode/yaml",
      "@codemirror/legacy-modes/mode/xml",
      "@lezer/highlight",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 生产构建分包：按依赖拆 vendor chunk，避免单个入口 js 超过 500 kB
  // （CodeMirror 全家、legacy 代码语言、React、Tauri 插件、图标各自独立 chunk，
  //   浏览器可长期缓存；@mdeditor/* workspace 源码留在主 chunk）
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@codemirror/legacy-modes")) return "cm-modes";
          // view + state 同 chunk：view 依赖 state，合并避免循环 chunk
          if (id.includes("@codemirror/state") || id.includes("@codemirror/view")) return "cm-view";
          if (id.includes("@codemirror") || id.includes("@lezer")) return "codemirror";
          if (id.includes("@fortawesome")) return "icons";
          if (id.includes("react") || id.includes("i18next") || id.includes("scheduler")) return "react";
          if (id.includes("@tauri-apps")) return "tauri";
          return undefined;
        },
      },
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // 允许访问 workspace 根目录（packages/* 经 node_modules 符号链接解析）
    fs: {
      allow: [".."],
    },
    // 预热应用源码：服务器启动即编译入口与核心模块，
    // 首屏不再逐个请求触发 esbuild 编译（进一步消除白屏）。
    // 注意：必须用 ./ 相对根目录的路径（/ 开头会被当作绝对文件路径 → /@fs/... 不存在）
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/App.tsx",
        "./src/App.css",
        "./src/i18n.ts",
        "./src/components/ActivityBar.tsx",
        "./src/components/MenuBar.tsx",
        "./src/components/Sidebar.tsx",
        "./src/components/FileTree.tsx",
        "./src/components/TitleBar.tsx",
        "./src/components/StatusBar.tsx",
        "./src/components/WelcomePage.tsx",
        "./packages/md-editor/src/index.ts",
        "./packages/md-editor/src/wysiwyg/index.ts",
        "./packages/md-editor/src/wysiwyg/decorations.ts",
        "./packages/md-editor/src/wysiwyg/plugin.ts",
        "./packages/md-editor/src/wysiwyg/widgets.ts",
        "./packages/md-editor/src/wysiwyg/codeBlock.ts",
        "./packages/md-editor/src/wysiwyg/codeLanguages.ts",
      ],
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
