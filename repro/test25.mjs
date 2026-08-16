// repro/test25.mjs —— 边框验证(无外竖线) + 长表格逐格对齐列号验证 + 截图
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
  await page.setViewport({ width: 1100, height: 900 });
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

  // 1) 边框:首列无左边框、末列无右边框、内部列有左边框
  const border = await page.evaluate(() => {
    const row = document.querySelector("#editor .cm-line.md-table-row");
    const cells = Array.from(row.querySelectorAll(".md-table-cell"));
    const bl = (c) => getComputedStyle(c).borderLeftWidth;
    const br = (c) => getComputedStyle(c).borderRightWidth;
    return {
      first: { cls: cells[0].className, bl: bl(cells[0]), br: br(cells[0]) },
      mid: { cls: cells[1].className, bl: bl(cells[1]), br: br(cells[1]) },
      last: { cls: cells[2].className, bl: bl(cells[2]), br: br(cells[2]) },
    };
  });
  console.log("边框:", JSON.stringify(border, null, 2));
  const borderOk =
    border.first.bl === "0px" && border.first.br === "0px" &&
    border.mid.bl !== "0px" && border.mid.br === "0px" &&
    border.last.bl !== "0px" && border.last.br === "0px";
  console.log(borderOk ? "✅ 无外竖线,内部竖线保留" : "❌ 边框不符合要求");

  await page.screenshot({ path: "repro/table-fixed-1100.png" });

  // 2) 对齐:每个数据行 × 每列,光标放入后点击居中,验证分隔行对应列变化
  const clickAlignIn = async (rowIdx, colIdx) => {
    await page.evaluate(({ rowIdx, colIdx }) => {
      const lines = window.__ed.getValue().split("\n");
      let pos = 0;
      for (let i = 0; i < rowIdx; i++) pos += lines[i].length + 1;
      const r = lines[rowIdx];
      let count = 0, idx = -1;
      for (let k = 0; k < r.length; k++) {
        if (r[k] === "|") { count++; if (count === colIdx + 1) { idx = k; break; } }
      }
      window.__ed.setCursor(pos + idx + 1, false);
      window.__ed.focus();
      const btns = Array.from(document.querySelectorAll(".md-table-toolbar button"));
      const b = btns.find((x) => x.title === "列居中");
      if (b) b.click();
    }, { rowIdx, colIdx });
    await sleep(250);
    const delim = await page.evaluate(() => window.__ed.getValue().split("\n")[1]);
    return delim;
  };

  let allOk = true;
  for (const rowIdx of [2, 3, 4]) {
    for (const colIdx of [0, 1, 2]) {
      await page.evaluate((d) => window.__ed.setValue(d), doc);
      await sleep(300);
      const delim = await clickAlignIn(rowIdx, colIdx);
      const seg = delim.split("|")[colIdx + 1] ?? "";
      const centered = seg.includes(":---:");
      const ok = centered;
      if (!ok) allOk = false;
      console.log(`光标行${rowIdx} 列${colIdx}: 分隔行=${JSON.stringify(delim)} → 第${colIdx}列居中=${centered} ${ok ? "OK" : "❌"}`);
    }
  }
  console.log(allOk ? "\n✅ 全部行列对齐均作用在光标所在列" : "\n❌ 存在作用错列的情况");
} finally {
  await browser.close();
}
