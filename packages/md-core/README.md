# @mdeditor/md-core

Markdown 解析 + 渲染核心库。

- 纯逻辑，无 UI / 框架 / Tauri 依赖
- 输出语义化 HTML，样式由主题层注入
- 规划能力：GFM、代码高亮（highlight.js）、数学公式（KaTeX）、Mermaid、大纲提取、插件注册

```ts
import { render } from '@mdeditor/md-core';

const html = render('# Hello');
```
