import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
// Font Awesome 图标（@fortawesome/fontawesome-free，CSS 类名方式）
import "@fortawesome/fontawesome-free/css/all.min.css";

// 禁用 WebView 默认右键菜单（检查/查看网页源码等网页选项）：
// 应用内右键功能统一走自定义 UI（菜单栏-视图-开发者工具等），不暴露浏览器菜单
window.addEventListener(
  "contextmenu",
  (e) => {
    e.preventDefault();
  },
  { capture: true },
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
