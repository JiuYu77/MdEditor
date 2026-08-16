# @mdeditor/md-editor

编辑器内核封装库（WYSIWYG / 源码双模式）。

- 框架无关实例 API：`createEditor(el, options): EditorInstance`
- 源码模式：CodeMirror 6；WYSIWYG：ProseMirror（规划）
- 渲染依赖 `@mdeditor/md-core`，样式由主题层注入

```ts
import { createEditor } from '@mdeditor/md-editor';

const editor = createEditor(document.getElementById('app')!, {
  mode: 'wysiwyg',
  value: '# Hello',
});
```
