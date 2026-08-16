// repro/test15.mjs —— 复现:输入内容后光标跑到单元格边框上
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
    "结尾",
  ].join("\n");

  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(600);

  // 光标放到最后一行 "山东" 单元格末尾（t2 列、第 5 行）
  const placeCursorEndOfShandong = () =>
    page.evaluate(() => {
      const v = window.__ed.getValue();
      const lines = v.split("\n");
      let pos = 0;
      for (let i = 0; i < 4; i++) pos += lines[i].length + 1;
      // 第 5 行: | sdf | 山东 |  -> 光标放在 "山东" 之后、行末管道之前
      const row = lines[4];
      const cellEnd = pos + row.indexOf("山东") + 2;
      window.__ed.setCursor(cellEnd, false);
      window.__ed.focus();
      return cellEnd;
    });

  // 测量:光标(.cm-cursor)与单元格 span 的几何关系
  const measure = () =>
    page.evaluate(() => {
      const out = {};
      const cells = Array.from(document.querySelectorAll("#editor .cm-line.md-table-row .md-table-cell"));
      const row = document.querySelectorAll("#editor .cm-line.md-table-row")[2]; // 最后数据行
      const cell = row ? row.querySelectorAll(".md-table-cell")[1] : null;
      if (cell) {
        const r = cell.getBoundingClientRect();
        out.cell = { left: r.left, right: r.right, width: r.width, text: cell.textContent };
        // 单元格内文本末尾字符的右边缘
        const lastText = cell.lastChild;
        if (lastText && lastText.nodeType === 3) {
          const range = document.createRange();
          range.setStart(lastText, lastText.textContent.length - 1);
          range.setEnd(lastText, lastText.textContent.length);
          const rr = range.getBoundingClientRect();
          out.lastCharRight = rr.right;
        }
      }
      // CM6 自绘光标
      const cur = document.querySelector("#editor .cm-cursor");
      if (cur) {
        const r = cur.getBoundingClientRect();
        out.caret = { left: r.left, right: r.right, width: r.width };
      }
      // 光标处 DOM 结构（最后几层）
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        out.selText = range.startContainer.textContent ? range.startContainer.textContent.slice(0, 20) : "(空文本节点)";
        out.selOffset = range.startOffset;
        out.selParent = range.startContainer.parentElement ? range.startContainer.parentElement.className.slice(0, 40) : "(无)";
      }
      out.rowHTML = row ? row.innerHTML.slice(0, 300) : "(无行)";
      return out;
    });

  await placeCursorEndOfShandong();
  await sleep(400);
  console.log("== 输入前 ==");
  console.log(JSON.stringify(await measure(), null, 2));

  // 输入一个中文字符
  await page.keyboard.type("啊");
  await sleep(400);
  console.log("== 输入 '啊' 后 ==");
  console.log(JSON.stringify(await measure(), null, 2));

  // 再输入更多内容直到换行
  await page.keyboard.type("的的的的的的的的的的的的的的的的");
  await sleep(400);
  console.log("== 输入长串后 ==");
  console.log(JSON.stringify(await measure(), null, 2));

  console.log("\n文档: " + JSON.stringify(await page.evaluate(() => window.__ed.getValue())));
} finally {
  await browser.close();
}
