import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

const doc = [
  "```c",
  "#include <stdio.h>",
  "int main() {",
  '  printf("hi\\n");',
  "  return 0;",
  "}",
  "```",
  "",
  "山东泰安",
  "========",
  "",
  "| _t1_ | _t2_ |",
  "| ---- | ---- |",
  "| a    | b    |",
].join("\n");

const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
const tree = syntaxTree(state);
const out = [];
tree.iterate({ enter: (n) => {
  out.push({ name: n.name, from: n.from, to: n.to, text: JSON.stringify(doc.slice(n.from, n.to)) });
}});
console.log(JSON.stringify(out, null, 1));
