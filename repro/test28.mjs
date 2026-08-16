// repro/test28.mjs —— 单元格内容垂直居中验证
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:1520/repro/test9.html";
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, fail = 0;
const check = (name, c, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"}  ${name}${extra ? "  [" + extra + "]" : ""}`);
  c ? ok++ : fail++;
};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
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
  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(600);

  // 取每行的每个单元格:文字中心 y 与单元格中心 y 的差
  const rows = await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll("#editor .cm-line"));
    const trs = lines.filter((l) => l.classList.contains("md-table-row") || l.classList.contains("md-table-header"));
    return trs.map((r) => {
      const cells = Array.from(r.querySelectorAll(".md-table-cell")).map((c) => {
        const cr = c.getBoundingClientRect();
        // 文本中心:取所有文本节点范围的中心 y(排除隐藏空格 span)
        const texts = Array.from(c.childNodes).filter((n) => n.nodeType === 3);
        let t = 0, n = 0;
        texts.forEach((tx) => {
          if (!tx.textContent) return;
          const rng = document.createRange();
          rng.selectNodeContents(tx);
          const rr = rng.getBoundingClientRect();
          if (rr.height > 0) { t += rr.top + rr.height / 2; n++; }
        });
        const textCenter = n ? t / n : cr.top + cr.height / 2;
        return {
          text: c.textContent.slice(0, 8),
          cellH: Math.round(cr.height),
          cellCenterY: Math.round(cr.top + cr.height / 2),
          textCenterY: Math.round(textCenter),
          diff: Math.round(textCenter - (cr.top + cr.height / 2)),
        };
      });
      const rb = r.getBoundingClientRect();
      return { rowH: Math.round(rb.height), cells };
    });
  });

  rows.forEach((row, i) => {
    console.log(`行${i} 高${row.rowH}:`, JSON.stringify(row.cells));
  });

  // 断言:每个单元格文字中心与单元格中心偏差 < 4px
  let allCentered = true;
  rows.forEach((row) => {
    row.cells.forEach((c) => {
      if (Math.abs(c.diff) > 4) allCentered = false;
    });
  });
  check("所有单元格内容垂直居中(|diff|<=4)", allCentered);

  // 同一行内:各单元格文字中心应在同一水平线(相差 < 3px)
  let sameLine = true;
  rows.forEach((row) => {
    const cs = row.cells.map((c) => c.textCenterY);
    const avg = cs.reduce((a, b) => a + b, 0) / cs.length;
    cs.forEach((v) => { if (Math.abs(v - avg) > 3) sameLine = false; });
  });
  check("同行文字在同一水平线", sameLine);

  await page.screenshot({ path: "repro/table-valign.png" });
  console.log(`\n${ok} 通过 / ${fail} 失败`);
} finally {
  await browser.close();
}
