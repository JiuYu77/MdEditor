import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// 无头 UI 测试专用：把 Tauri invoke/dialog/opener 替换为内存 mock
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@tauri-apps/api/core": path.join(here, "mock-core.ts"),
      "@tauri-apps/api/window": path.join(here, "mock-window.ts"),
      "@tauri-apps/plugin-dialog": path.join(here, "mock-dialog.ts"),
      "@tauri-apps/plugin-opener": path.join(here, "mock-opener.ts"),
      "@tauri-apps/plugin-clipboard-manager": path.join(here, "mock-clipboard.ts"),
    },
  },
  optimizeDeps: {
    // 避免优化器追进插件包内部再解析别名
    exclude: ["@tauri-apps/plugin-opener", "@tauri-apps/plugin-dialog"],
  },
  server: {
    port: 5174,
    strictPort: true,
    fs: { allow: [".."] },
  },
});
