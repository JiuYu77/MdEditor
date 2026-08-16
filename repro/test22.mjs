// repro/test22.mjs —— 真实损坏行形态 + 无前导管道行:渲染与对齐验证
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

  const dump = () =>
    page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll("#editor .cm-line"));
      return lines
        .filter((l) => l.classList.contains("md-table-row") || l.classList.contains("md-table-header"))
        .map((l) => ({
          text: JSON.stringify(l.textContent.slice(0, 22)),
          cells: Array.from(l.querySelectorAll(".md-table-cell")).map((c) => ({
            t: c.textContent.slice(0, 8),
            align: c.className.match(/md-table-align-([lcr])/)?.[1] ?? "?",
            w: Math.round(c.getBoundingClientRect().width),
          })),
        }));
    });

  // 场景A: 用户真实损坏行形态(无末尾管道 + 中间空单元格)
  const docA = [
    "| 项目 | 说明 |",
    "| --- | --- |",
    "| 的的 | 单独的 sss |",
    "|  的的 |  |单独的",
    "| 11 是否 | 22 |",
    "",
  ].join("\n");

  // 场景B: 无前导管道行
  const docB = [
    "| t1 | t2 | t3 |",
    "| :--- | --- | --- |",
    "| a1 | b1 | c1 |",
    "a2 | b2 | c2",
    "| a3 | b3 | c3 |",
    "",
  ].join("\n");

  const run = async (name, doc) => {
    await page.evaluate((d) => window.__ed.setValue(d), doc);
    await sleep(500);
    console.log(`\n===== ${name} =====`);
    const rows = await dump();
    rows.forEach((r, i) => console.log(` 行${i} ${r.text} cells=${JSON.stringify(r.cells)}`));
    // 点击列居中(光标放中间行第2列)
    await page.evaluate(() => {
      const lines = window.__ed.getValue().split("\n");
      let pos = 0;
      for (let i = 0; i < 3; i++) pos += lines[i].length + 1;
      const r = lines[3];
      let count = 0, idx = -1;
      for (let k = 0; k < r.length; k++) {
        if (r[k] === "|") { count++; if (count === 2) { idx = k; break; } }
      }
      window.__ed.setCursor(pos + idx + 1, false);
      window.__ed.focus();
      const btns = Array.from(document.querySelectorAll(".md-table-toolbar button"));
      const b = btns.find((x) => x.title === "列居中");
      if (b) b.click();
    });
    await sleep(400);
    const after = await page.evaluate(() => window.__ed.getValue());
    console.log("点击居中后分隔行: " + JSON.stringify(after.split("\n")[1]));
    const rows2 = await dump();
    rows2.forEach((r, i) => console.log(` 行${i} ${r.text} cells=${JSON.stringify(r.cells)}`));
  };

  await run("场景A 真实损坏行", docA);
  await run("场景B 无前导管道行", docB);
} finally {
  await browser.close();
}
