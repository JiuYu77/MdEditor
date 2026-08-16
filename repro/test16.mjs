// repro/test16.mjs —— 复现2:长内容换行时光标位置 + 窄容器压缩场景
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

  const measure = () =>
    page.evaluate(() => {
      const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
      const row = rows[rows.length - 1];
      const cell = row ? row.querySelectorAll(".md-table-cell")[1] : null;
      const out = { container: document.querySelector("#editor .cm-content").clientWidth };
      if (cell) {
        const r = cell.getBoundingClientRect();
        out.cell = { left: r.left, right: r.right, width: r.width, text: cell.textContent.slice(0, 40) };
      }
      const cur = document.querySelector("#editor .cm-cursor");
      if (cur) {
        const r = cur.getBoundingClientRect();
        out.caret = { left: r.left, right: r.right };
      }
      if (cell && cur) {
        const cr = cell.getBoundingClientRect();
        out.caretDistFromRightBorder = Math.round(cr.right - cur.getBoundingClientRect().right);
      }
      return out;
    });

  const placeEndOfCell2 = () =>
    page.evaluate(() => {
      const lines = window.__ed.getValue().split("\n");
      let pos = 0;
      for (let i = 0; i < 4; i++) pos += lines[i].length + 1;
      const row = lines[4];
      // 第 2 个单元格末尾 = 第 3 个管道前（含尾部空格之前）
      const thirdPipe = row.indexOf("|", row.indexOf("|", row.indexOf("|") + 1) + 1);
      const cellEnd = pos + thirdPipe;
      window.__ed.setCursor(cellEnd, false);
      window.__ed.focus();
    });

  await placeEndOfCell2();
  await sleep(400);
  console.log("== 光标在 山东 单元格末尾 ==");
  console.log(JSON.stringify(await measure(), null, 2));

  // 输入超长内容触发换行
  await page.keyboard.type("这是一段非常非常长的中文内容用来测试表格单元格换行时光标的位置是否正常");
  await sleep(400);
  console.log("== 输入超长内容(触发换行)后 ==");
  console.log(JSON.stringify(await measure(), null, 2));

  // 文档文本
  const v = await page.evaluate(() => window.__ed.getValue());
  console.log("文档: " + JSON.stringify(v));

  // 换行后继续输入,观察光标
  await page.keyboard.type("继续输入看看光标还在不在边框上");
  await sleep(400);
  console.log("== 换行后继续输入 ==");
  console.log(JSON.stringify(await measure(), null, 2));
} finally {
  await browser.close();
}
