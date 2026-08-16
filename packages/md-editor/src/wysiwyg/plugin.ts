/**
 * WYSIWYG 视图插件（@mdeditor/md-editor 内部）
 * ViewPlugin：文档/视口/光标行变化时按可见范围重建装饰；
 * 光标行源码显示开关由 StateEffect + StateField 承载
 */
import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { buildWysiwygDecorations } from "./decorations";

/** 光标行显示源码开关（StateField：跟随 effect 更新，默认开） */
export const setCursorLineSource = StateEffect.define<boolean>();
export const cursorLineSourceStateField = StateField.define<boolean>({
  create: () => true,
  update: (v, tr) => {
    for (const e of tr.effects) {
      if (e.is(setCursorLineSource)) return e.value;
    }
    return v;
  },
});

/** WYSIWYG 视图插件（内部件，供本文件 wysiwygPlugin 使用） */
class WysiwygView {
  decorations: DecorationSet;
  private cursorLine = -1;
  private enabled = true;
  constructor(view: EditorView) {
    this.cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
    this.enabled = view.state.field(cursorLineSourceStateField);
    this.decorations = buildWysiwygDecorations(view, this.enabled ? this.cursorLine : 0);
  }
  update(update: ViewUpdate) {
    // 光标行变化（跨行移动）或开关变化时按视口重建；列内移动不重建
    const cursorLine = update.state.doc.lineAt(update.state.selection.main.head).number;
    const enabled = update.state.field(cursorLineSourceStateField);
    const cursorChanged = cursorLine !== this.cursorLine || enabled !== this.enabled;
    this.cursorLine = cursorLine;
    this.enabled = enabled;
    if (update.docChanged || update.viewportChanged || cursorChanged) {
      this.decorations = buildWysiwygDecorations(update.view, enabled ? cursorLine : 0);
    }
  }
}

export const wysiwygPlugin = ViewPlugin.fromClass(WysiwygView, {
  decorations: (v) => v.decorations,
});
