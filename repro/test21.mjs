// repro/test21.mjs —— 用户确切表格:逐行点击对齐按钮,验证分隔行变更 + 每行对齐类
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

  // 光标放到 第 row 行(0=表头,2..4=数据行) 第 col 列(0/1)单元格内
  const placeCursor = (row, col) =>
    page.evaluate(({ row, col }) => {
      const lines = window.__ed.getValue().split("\n");
      let pos = 0;
      for (let i = 0; i < row; i++) pos += lines[i].length + 1;
      const r = lines[row];
      let count = 0, idx = -1;
      for (let k = 0; k < r.length; k++) {
        if (r[k] === "|") { count++; if (count === col + 1) { idx = k; break; } }
      }
      window.__ed.setCursor(pos + idx + 1, false);
      window.__ed.focus();
    }, { row, col });

  const clickAlign = (title) =>
    page.evaluate((t) => {
      const btns = Array.from(document.querySelectorAll(".md-table-toolbar button"));
      const b = btns.find((x) => x.title === t);
      if (b) b.click();
    }, title);

  const state = () =>
    page.evaluate(() => {
      const v = window.__ed.getValue();
      const delim = v.split("\n")[1];
      const rows = Array.from(document.querySelectorAll("#editor .cm-line"));
      const trs = rows.filter((l) => l.classList.contains("md-table-row") || l.classList.contains("md-table-header"));
      return {
        delim,
        rows: trs.map((l) => Array.from(l.querySelectorAll(".md-table-cell")).map((c) => c.className.match(/md-table-align-([lcr])/)?.[1] ?? "?")),
        cellCounts: trs.map((l) => l.querySelectorAll(".md-table-cell").length),
      };
    });

  // 每个数据行 × 每列,点击居中,检查分隔行 + 各列类
  for (const row of [2, 3, 4]) {
    for (const col of [0, 1]) {
      // 先重置分隔行
      await page.evaluate((d) => window.__ed.setValue(d), doc);
      await sleep(350);
      await placeCursor(row, col);
      await sleep(200);
      await clickAlign("列居中");
      await sleep(300);
      const s = await state();
      const expect = s.delim.split("|")[col + 1].includes(":---:");
      const colAligned = s.rows.every((r) => r[col] === "c");
      console.log(`光标行${row} 列${col}: 分隔行=${JSON.stringify(s.delim)} 单元格数=${JSON.stringify(s.cellCounts)} 列${col}全c=${colAligned} ${expect && colAligned ? "OK" : "❌"}`);
    }
  }

  // 重复点击同一按钮 5 次,确认每次都生效(非偶发)
  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(400);
  await placeCursor(3, 1);
  await sleep(200);
  let allChanged = true;
  const before = await page.evaluate(() => window.__ed.getValue().split("\n")[1]);
  for (let i = 0; i < 5; i++) {
    await clickAlign("列居中");
    await sleep(150);
    const d = await page.evaluate(() => window.__ed.getValue().split("\n")[1]);
    if (d === before) { allChanged = false; console.log(`重复点击第${i + 1}次:分隔行未变 ${JSON.stringify(d)}`); }
  }
  const after5 = await page.evaluate(() => window.__ed.getValue().split("\n")[1]);
  console.log(`重复点击5次: ${allChanged ? "每次均生效" : "存在未生效"} → ${JSON.stringify(after5)}`);
} finally {
  await browser.close();
}
