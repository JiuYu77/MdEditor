// repro/test34.mjs —— 编辑器内查找(Ctrl+F)面板验证
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:1520/repro/test9.html";
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, fail = 0;
const check = (name, c, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"}  ${name}${extra ? "  [" + extra + "]" : ""}`);
  c ? ok++ : fail++;
};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__ed, { timeout: 20000 });

  const doc = ["# 标题", "正文 content 测试", "CONTENT 大写", "另一段 content", "结尾 content!"].join("\n");
  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(500);

  // Ctrl+F 打开查找面板（先聚焦编辑器，CM keymap 才收到按键）
  await page.evaluate(() => window.__ed.focus());
  await sleep(200);
  await page.keyboard.down("Control");
  await page.keyboard.press("f");
  await page.keyboard.up("Control");
  await sleep(400);

  const panel = await page.evaluate(() => {
    const p = document.querySelector("#editor .cm-search");
    if (!p) return null;
    const inputs = p.querySelectorAll("input");
    const buttons = Array.from(p.querySelectorAll("button")).map((b) => ({
      title: b.title,
      text: b.textContent?.trim(),
      cls: b.className,
    }));
    const labels = Array.from(p.querySelectorAll(".cm-search-label, .cm-search-labels label")).map((l) =>
      (l.textContent ?? "").trim(),
    );
    return { inputs: inputs.length, buttons, labels, text: p.textContent?.slice(0, 100) };
  });
  console.log("查找面板: inputs=", panel?.inputs, "labels=", JSON.stringify(panel?.labels));
  check("Ctrl+F 打开查找面板", panel != null && panel.inputs >= 1);

  // 面板选项按钮(CM6 默认:match case / regexp / by word,在 label 中)
  if (panel) {
    const texts = (panel.labels.join("|") + "|" + panel.text).toLowerCase();
    check("区分大小写按钮", texts.includes("match case"), texts.slice(0, 60));
    check("整个单词按钮", texts.includes("by word"), texts.slice(0, 60));
    check("正则按钮", texts.includes("regexp"), texts.slice(0, 60));
  }

  // 输入查询词,检查匹配高亮与计数
  await page.type("#editor .cm-search input", "content");
  await sleep(500);
  const r = await page.evaluate(() => {
    const matches = document.querySelectorAll("#editor .cm-searchMatch").length;
    return { matchEls: matches };
  });
  console.log("搜索 content:", JSON.stringify(r));
  check("匹配高亮出现", r.matchEls >= 3, "matchEls=" + r.matchEls);

  // findNext(F3) 跳转下一个匹配,检查编辑器选区与当前匹配高亮
  const selBefore = await page.evaluate(() => {
    const s = window.getSelection();
    return s.rangeCount ? s.toString() : "";
  });
  await page.keyboard.press("F3");
  await sleep(300);
  const selAfter = await page.evaluate(() => {
    const s = window.getSelection();
    return s.rangeCount ? s.toString() : "";
  });
  check("F3 跳转到匹配(选中 content)", selAfter.includes("content"), "before=" + JSON.stringify(selBefore) + " after=" + JSON.stringify(selAfter));
  const selMark = await page.evaluate(() => document.querySelectorAll("#editor .cm-searchMatch-selected").length);
  check("当前匹配高亮(selected)", selMark >= 1, "selected=" + selMark);

  // Esc 关闭
  await page.keyboard.press("Escape");
  await sleep(300);
  const closed = await page.evaluate(() => !document.querySelector("#editor .cm-search"));
  check("Esc 关闭面板", closed);

  console.log(`\n${ok} 通过 / ${fail} 失败`);
} finally {
  await browser.close();
}
