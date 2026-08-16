# @mdeditor/md-export

导出库：HTML / PDF / 图片。

- 依赖 `@mdeditor/md-core` 渲染
- 导出时内嵌主题 CSS（主题包），保持主题样式

```ts
import { exportHtml } from '@mdeditor/md-export';

const html = exportHtml('# Hello', { themeCss });
```
