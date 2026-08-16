// repro/test20.mjs —— 对齐按钮:多行/多形态表格下逐行验证对齐类是否全部生效
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

  // 场景1: 全部规整的行
  const clean = [
    "| t1 | t2 | t3 |",
    "| :--- | --- | --- |",
    "| a1 | b1 | c1 |",
    "| a2 | b2 | c2 |",
    "| a3 | b3 | c3 |",
    "",
  ].join("\n");

  // 场景2: 有一行缺末尾管道(非法 GFM 行)
  const mixed = [
    "| t1 | t2 | t3 |",
    "| :--- | --- | --- |",
    "| a1 | b1 | c1 |",
    "| a2 | b2 | c2",
    "| a3 | b3 | c3 |",
    "",
  ].join("\n");

  // 场景3: 有一行中间空单元格
  const emptyCell = [
    "| t1 | t2 | t3 |",
    "| :--- | --- | --- |",
    "| a1 | b1 | c1 |",
    "| a2 |  | c2 |",
    "| a3 | b3 | c3 |",
    "",
  ].join("\n");

  const dumpAlign = () =>
    page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll("#editor .cm-line"));
      const tableRows = lines.filter((l) => l.classList.contains("md-table-row") || l.classList.contains("md-table-header"));
      return tableRows.map((l) => ({
        text: l.textContent.slice(0, 18),
        aligns: Array.from(l.querySelectorAll(".md-table-cell")).map((c) => c.className.match(/md-table-align-([lcr])/)?.[1] ?? "?"),
        widths: Array.from(l.querySelectorAll(".md-table-cell")).map((c) => Math.round(c.getBoundingClientRect().width)),
      }));
    });

  const clickAlign = (col, alignTitle) =>
    page.evaluate(({ col, alignTitle }) => {
      // 光标放到第 2 数据行(行 3), 第 col 列单元格内(该列第 col+1 个管道之后)
      const lines = window.__ed.getValue().split("\n");
      let pos = 0;
      for (let i = 0; i < 3; i++) pos += lines[i].length + 1;
      const row = lines[3];
      // 找第 col+1 个管道后的位置
      let idx = -1, count = 0;
      for (let k = 0; k < row.length; k++) {
        if (row[k] === "|") { count++; if (count === col + 1) { idx = k; break; } }
      }
      window.__ed.setCursor(pos + idx + 1, false);
      window.__ed.focus();
      const btns = Array.from(document.querySelectorAll(".md-table-toolbar button"));
      const b = btns.find((x) => x.title === alignTitle);
      if (b) b.click();
    }, { col, alignTitle });

  const run = async (name, doc) => {
    await page.evaluate((d) => window.__ed.setValue(d), doc);
    await sleep(500);
    console.log(`\n===== ${name} =====`);
    console.log("初始分隔行: " + JSON.stringify((await page.evaluate(() => window.__ed.getValue())).split("\n")[1]));
    await clickAlign(2, "列居中");
    await sleep(400);
    const after = await page.evaluate(() => window.__ed.getValue());
    console.log("点击居中后分隔行: " + JSON.stringify(after.split("\n")[1]));
    console.log("各行对齐类(应为第3列全部 c):");
    const rows = await dumpAlign();
    rows.forEach((r, i) => console.log(` 行${i} text=${JSON.stringify(r.text)} aligns=${JSON.stringify(r.aligns)} widths=${JSON.stringify(r.widths)}`));
    const bad = rows.filter((r, i) => i !== 1 && r.aligns.length === 3 && r.aligns[2] !== "c");
    console.log(bad.length ? `  ❌ ${bad.length} 行未生效` : "  ✅ 全部行第3列均为 c");
  };

  await run("场景1 规整表格", clean);
  await run("场景2 含缺末尾管道行", mixed);
  await run("场景3 含空单元格", emptyCell);
} finally {
  await browser.close();
}
