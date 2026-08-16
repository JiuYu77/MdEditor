// repro/test19.mjs —— 窄容器:列宽压缩 + 超长内容换行时光标位置
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:1520/repro/test9.html";
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 500, height: 900 });
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
      const cur = document.querySelector("#editor .cm-cursor");
      const out = {
        container: document.querySelector("#editor .cm-content").clientWidth,
        cellH: cell ? Math.round(cell.getBoundingClientRect().height) : null,
        cellW: cell ? Math.round(cell.getBoundingClientRect().width) : null,
      };
      if (cell && cur) {
        out.caretDistFromRightBorder = Math.round(cell.getBoundingClientRect().right - cur.getBoundingClientRect().right);
        out.caretTop = Math.round(cur.getBoundingClientRect().top);
        out.cellTop = Math.round(cell.getBoundingClientRect().top);
      }
      return out;
    });

  // 光标到 "山东" 单元格末尾(c.to)
  await page.evaluate(() => {
    const lines = window.__ed.getValue().split("\n");
    let pos = 0;
    for (let i = 0; i < 4; i++) pos += lines[i].length + 1;
    const row = lines[4];
    const cellEnd = pos + row.indexOf("山东") + 3; // 管道位置
    window.__ed.setCursor(cellEnd, false);
    window.__ed.focus();
  });
  await sleep(400);
  console.log("== 压缩后,光标在 山东 末尾 ==");
  console.log(JSON.stringify(await measure()));

  // 输入超长内容 → 压缩 + 换行
  await page.keyboard.type("这是一段非常非常长的中文内容用来测试表格单元格在窄容器下压缩换行时光标的位置是否正常");
  await sleep(500);
  console.log("== 输入超长内容(压缩+换行)后 ==");
  console.log(JSON.stringify(await measure()));
  console.log("单元格文本: " + JSON.stringify(await page.evaluate(() => {
    const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
    const row = rows[rows.length - 1];
    return row ? row.querySelectorAll(".md-table-cell")[1].textContent : null;
  })));
} finally {
  await browser.close();
}
