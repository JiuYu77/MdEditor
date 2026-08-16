/**
 * WYSIWYG 自定义扩展（@mdeditor/md-editor 内部，对标 Obsidian src/editor_extensions 的组织方式）
 * - widgets.ts       自定义 Widget（列表圆点/序号/任务复选框/图片/链接）
 * - codeBlock.ts     代码块渲染（工具栏 Widget/语言切换/复制/折叠服务）
 * - codeLanguages.ts 代码块语言描述（同步挂载，供代码高亮）
 * - table.ts         表格渲染（斑马纹/列宽对齐）+ 表格操作（浮动按钮/菜单/点击定位）
 * - decorations.ts   装饰构建（隐藏语法标记 + 实时样式，视口级遍历）
 * - plugin.ts        ViewPlugin + 光标行源码开关
 * - tree.ts / popup.ts / clipboard.ts  语法树、弹层、剪贴板共用工具
 */
export { wysiwygPlugin, cursorLineSourceStateField, setCursorLineSource } from "./plugin";
export { codeFoldService } from "./codeBlock";
export { codeLanguages } from "./codeLanguages";
export { tableToolbarPlugin } from "./table";
