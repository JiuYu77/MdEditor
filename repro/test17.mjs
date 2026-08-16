// repro/test17.mjs —— 检查光标在单元格末尾时 DOM 选区锚点位置
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
    "| t1 | t2 |",
    "| :--- | --- |",
    "| 的的 | 单独的 sss的上述水水水水水sssss |",
    "| 11 是否 | 22 ss |",
    "| sdf | 山东 |",
    "",
  ].join("\n");
  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(600);

  // 依次测试单元格内不同位置的光标
  const tests = [
    { name: "offset 3 (东之后,空格前)", off: 3 },
    { name: "offset 4 (c.to 单元格末尾=管道位置)", off: 4 },
    { name: "offset 2 (山东中间)", off: 2 },
  ];
  for (const t of tests) {
    await page.evaluate((off) => {
      const lines = window.__ed.getValue().split("\n");
      let pos = 0;
      for (let i = 0; i < 4; i++) pos += lines[i].length + 1;
      const row = lines[4];
      const cellStart = pos + row.indexOf("山东") - 1; // 单元格起始(含前导空格)
      window.__ed.setCursor(cellStart + off, false);
      window.__ed.focus();
    }, t.off);
    await sleep(300);
    const r = await page.evaluate(() => {
      const cell = document.querySelectorAll("#editor .cm-line.md-table-row")[2].querySelectorAll(".md-table-cell")[1];
      const cur = document.querySelector("#editor .cm-cursor");
      const sel = window.getSelection();
      let anchor = null;
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        const parent = range.startContainer;
        const cellEl = parent.nodeType === 3 ? parent.parentElement : parent;
        anchor = {
          nodeType: parent.nodeType === 3 ? "text" : "element",
          text: parent.nodeType === 3 ? parent.textContent : parent.tagName,
          offset: range.startOffset,
          inCell: cell.contains(cellEl) || cellEl === cell,
          parentCls: cellEl.className ? String(cellEl.className).slice(0, 40) : cellEl.tagName,
        };
      }
      return {
        caretLeft: cur ? cur.getBoundingClientRect().left : null,
        cellRight: cell ? cell.getBoundingClientRect().right : null,
        anchor,
        cellHTML: cell ? cell.innerHTML.slice(0, 120) : null,
      };
    });
    console.log(`[${t.name}]`, JSON.stringify(r));
  }
} finally {
  await browser.close();
}
