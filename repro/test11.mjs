// repro/test11.mjs —— 标题级别提示（光标聚焦标题行：无源码 + 左侧 H1~H6）
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:1420/repro/test9.html";
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  [" + extra + "]" : ""}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__ed, { timeout: 20000 });

  const doc = ["# 一级标题", "", "普通段落", "", "## 二级标题", "", "- 列表项", "", "山东泰安", "========"].join("\n");
  await page.evaluate((d) => window.__setValue(d), doc);
  await sleep(600);

  const moveCursor = async (line) => {
    await page.evaluate((ln) => {
      const lines = window.__ed.getValue().split("\n");
      let pos = 0;
      for (let i = 0; i < ln - 1; i++) pos += lines[i].length + 1;
      window.__ed.setCursor(pos, false);
    }, line);
    await sleep(350);
  };
  const lineInfo = (idx) =>
    page.evaluate((i) => {
      const l = document.querySelectorAll("#editor .cm-line")[i];
      if (!l) return null;
      const cs = getComputedStyle(l, "::before");
      return {
        text: l.textContent.slice(0, 22),
        cls: l.className.replace("cm-line", "").trim(),
        before: cs.content,
        cursorSource: l.classList.contains("md-cursor-source"),
      };
    }, idx);

  await moveCursor(1); // # 一级标题
  const r1 = await lineInfo(0);
  console.log("光标第1行(H1):", JSON.stringify(r1));
  check("H1: 不显示源码 + 左侧 H1 提示", !r1.text.includes("#") && r1.before === '"H1"' && !r1.cursorSource, r1.text + " / " + r1.before);

  await moveCursor(3); // 普通段落
  const r3 = await lineInfo(2);
  console.log("光标第3行(段落):", JSON.stringify(r3));
  check("段落行仍显示源码底色", r3.cursorSource, r3.cls);

  await moveCursor(5); // ## 二级标题
  const r5 = await lineInfo(4);
  console.log("光标第5行(H2):", JSON.stringify(r5));
  check("H2: 不显示源码 + 左侧 H2 提示", !r5.text.includes("##") && r5.before === '"H2"' && !r5.cursorSource, r5.text + " / " + r5.before);

  await moveCursor(9); // setext 标题（山东泰安\n========）
  const r9 = await lineInfo(8);
  console.log("光标第9行(Setext H1):", JSON.stringify(r9));
  check("Setext H1: 不显示源码 + 左侧 H1 提示", !r9.text.includes("====") && r9.before === '"H1"' && !r9.cursorSource, r9.text + " / " + r9.before);

  console.log(failed === 0 ? "\n全部通过 ✔" : `\n${failed} 项失败 ✘`);
} finally {
  await browser.close();
}
