// repro/test40.mjs —— 点击表格分隔行(表头下空行)：光标不进该行，重定向到同列表格单元格
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:1520/repro/test9.html";
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
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__lines, { timeout: 20000 });

  // 1) 设置表格(表头 + 分隔行 + 数据行)。分隔行 = doc 第 2 行
  const table = "| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |";
  await page.evaluate((t) => { window.__setValue(t); window.__curLine = null; window.__ed.onCursorChange((l) => { window.__curLine = l; }); }, table);
  await new Promise((r) => setTimeout(r, 700));

  // 2) 找到分隔行元素(空行, md-table-divider)，点击其中心
  const info = await page.evaluate(() => {
    const div = document.querySelector(".cm-line.md-table-divider");
    if (!div) return { found: false };
    const r = div.getBoundingClientRect();
    return { found: true, cx: r.left + r.width / 2, cy: r.top + r.height / 2, h: r.height };
  });
  check("找到分隔行", info.found, JSON.stringify(info));
  if (info.found) {
    // 3) 点击分隔行中心
    await page.evaluate(({ cx, cy }) => {
      const div = document.querySelector(".cm-line.md-table-divider");
      if (div) div.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    }, info);
    await new Promise((r) => setTimeout(r, 300));
    const res = await page.evaluate(() => {
      // 光标行(1-based)
      const line = window.__curLine;
      // 分隔行是 doc 第 2 行;若光标落在第 2 行说明仍进入空行
      return { line, value: window.__value() };
    });
    // 分隔行文本行号
    const delimLine = res.value.split("\n").findIndex((l) => /^\| *---/.test(l)) + 1;
    check("光标行不是分隔行", res.line !== delimLine, `光标=${res.line} 分隔行=${delimLine}`);
    check("光标落在表头或数据单元行", res.line === 1 || res.line === 3, `光标=${res.line}`);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
