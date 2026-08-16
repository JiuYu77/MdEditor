// repro/test23.mjs —— 复现:窄宽度表格错乱 + 对齐列号 + 截图
import puppeteer from "puppeteer-core";
import fs from "node:fs";

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
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__ed, { timeout: 20000 });

  const doc = [
    "| t1 | t2 | t3 |",
    "| :--- | --- | --- |",
    "| 的的 | 单独的 sss的上述水水水水水sssss | 黄河之水天上来 |",
    "| 是否 | 22 ss | 春江潮水连海平,海上明月共潮生 |",
    "| sdf | 山东 | 艳艳随波千万里,何处春江无月明。江流宛转绕芳甸,月照花林皆似霰 |",
    "",
  ].join("\n");

  const render = async (width) => {
    await page.setViewport({ width, height: 900 });
    await page.evaluate((d) => window.__ed.setValue(d), doc);
    await sleep(600);
    const info = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("#editor .cm-line.md-table-row"));
      const contentW = document.querySelector("#editor .cm-content").clientWidth;
      const all = [];
      rows.forEach((r, ri) => {
        const cells = Array.from(r.querySelectorAll(".md-table-cell")).map((c) => {
          const b = c.getBoundingClientRect();
          return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height), t: c.textContent.slice(0, 12) };
        });
        const rb = r.getBoundingClientRect();
        all.push({ row: ri, top: Math.round(rb.top), h: Math.round(rb.height), cells });
      });
      return { contentW, rows: all };
    });
    await page.screenshot({ path: `repro/table-w${width}.png` });
    return info;
  };

  for (const w of [1300, 800, 600, 450]) {
    const info = await render(w);
    console.log(`\n===== 宽度 ${w} (内容区 ${info.contentW}) =====`);
    info.rows.forEach((r) => {
      console.log(` 行${r.row} top=${r.top} h=${r.h} cells=${JSON.stringify(r.cells)}`);
    });
  }
} finally {
  await browser.close();
}
