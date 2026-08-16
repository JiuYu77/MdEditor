// repro/test18.mjs —— 当前代码:中间单元格边界的光标锚点 + 输入效果
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:1420/repro/test9.html";
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1300, height: 900 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__ed, { timeout: 20000 });

  const doc = [
    "| t1 | t2 | t3 |",
    "| :--- | --- | --- |",
    "| aa | bb | cc |",
    "| dd | 山东 | ff |",
    "",
  ].join("\n");
  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(600);

  const measure = () =>
    page.evaluate(() => {
      const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
      const row = rows[rows.length - 1];
      const cells = row ? row.querySelectorAll(".md-table-cell") : [];
      const cur = document.querySelector("#editor .cm-cursor");
      const sel = window.getSelection();
      let anchor = null;
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        const p = range.startContainer;
        const el = p.nodeType === 3 ? p.parentElement : p;
        let inAnyCell = false;
        cells.forEach((c) => { if (c.contains(el) || c === el) inAnyCell = true; });
        anchor = {
          nodeType: p.nodeType === 3 ? "text" : "element",
          text: p.nodeType === 3 ? JSON.stringify(p.textContent) : p.tagName,
          offset: range.startOffset,
          inAnyCell,
          elCls: el.className ? String(el.className).slice(0, 50) : el.tagName,
        };
      }
      const out = {
        caretLeft: cur ? cur.getBoundingClientRect().left : null,
        cells: Array.from(cells).map((c) => {
          const r = c.getBoundingClientRect();
          return { left: Math.round(r.left), right: Math.round(r.right), text: c.textContent.slice(0, 14) };
        }),
        anchor,
        rowHTML: row ? row.innerHTML.slice(0, 260) : null,
      };
      return out;
    });

  // 光标放到 " 山东 " 单元格末尾(c.to = 第2个管道, 即第3个管道开始? 不: 山东是第2列, 其后管道是第3个)
  // 行文本: | dd | 山东 | ff |  -> 管道: 0,4,8,12  (山东 在 5..7, 其末尾 c.to=8=第3个管道)
  await page.evaluate(() => {
    const lines = window.__ed.getValue().split("\n");
    let pos = 0;
    for (let i = 0; i < 3; i++) pos += lines[i].length + 1;
    const row = lines[3];
    const cellEnd = pos + row.indexOf("山东") + 3; // 山东 占2字 + 前导空格1 -> 末尾=管道前... indexOf(山东)=5, +3=8=管道位置
    window.__ed.setCursor(cellEnd, false);
    window.__ed.focus();
  });
  await sleep(400);
  console.log("== 光标在 山东 单元格末尾(中间列) ==");
  console.log(JSON.stringify(await measure(), null, 2));

  // 输入一个字符, 看它进入哪个单元格/锚点
  await page.keyboard.type("X");
  await sleep(400);
  console.log("== 输入 X 后 ==");
  console.log(JSON.stringify(await measure(), null, 2));
  console.log("文档: " + JSON.stringify(await page.evaluate(() => window.__ed.getValue())));
} finally {
  await browser.close();
}
