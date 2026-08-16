// repro/test30.mjs —— 多行单元格:各行文字右侧空白的聚焦 + 编辑器焦点
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
  await page.setViewport({ width: 750, height: 900 });
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
  await sleep(700);

  const clickProbe = async (x, y, label) => {
    await page.mouse.click(x, y);
    await sleep(200);
    const r = await page.evaluate(() => {
      const sel = window.getSelection();
      const range = sel.rangeCount ? sel.getRangeAt(0) : null;
      const p = range ? range.startContainer : null;
      const el = p && p.nodeType === 3 ? p.parentElement : p;
      let cell = null, node = el;
      while (node && node !== document.body) { if (node.classList && node.classList.contains("md-table-cell")) { cell = node.className.slice(0, 30); break; } node = node.parentElement; }
      const ed = document.querySelector("#editor");
      return {
        inCell: cell,
        cursor: window.__ed.getCursor(),
        edFocused: ed === document.activeElement || !!ed.querySelector(".cm-focused"),
      };
    });
    const colChar = await page.evaluate((c) => {
      const row = window.__ed.getValue().split("\n")[c.line - 1];
      return row ? row[c.col - 1] : null;
    }, r.cursor);
    console.log(`${label}: inCell=${r.inCell ? "✓" : "✗"} 编辑器焦点=${r.edFocused} 光标=行${r.cursor.line}列${r.cursor.col}「${colChar}」`);
    return { ...r, colChar };
  };

  // 各数据行单元格几何(含逐行文字 rect)
  const geo = await page.evaluate(() => {
    const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
    return Array.from(rows).map((row) => {
      return Array.from(row.querySelectorAll(".md-table-cell")).map((c) => {
        const cr = c.getBoundingClientRect();
        const texts = Array.from(c.childNodes).filter((n) => n.nodeType === 3 && n.textContent);
        const lineRects = [];
        let maxRight = cr.left, minLeft = cr.right;
        texts.forEach((t) => {
          const rng = document.createRange(); rng.selectNodeContents(t);
          Array.from(rng.getClientRects()).forEach((rr) => { if (rr.width > 0 && rr.height > 0) { lineRects.push({ top: rr.top, bottom: rr.bottom, left: rr.left, right: rr.right }); maxRight = Math.max(maxRight, rr.right); minLeft = Math.min(minLeft, rr.left); } });
        });
        return { left: cr.left, right: cr.right, top: cr.top, bottom: cr.bottom, textRight: maxRight, textLeft: minLeft, lines: lineRects };
      });
    });
  });

  const probes = [];
  geo.forEach((cells, ri) => {
    cells.forEach((c, ci) => {
      // 跳过最后一行 t1/t2 单行短文字已测过;重点 t2 短文字右侧 + t3 多行右侧
      if (ci === 2) {
        c.lines.forEach((l, li) => {
          const y = (l.top + l.bottom) / 2;
          probes.push([l.right + 10, y, `行${ri} t3第${li + 1}行右侧+10px`]);
          probes.push([l.right + 30, y, `行${ri} t3第${li + 1}行右侧+30px`]);
          probes.push([c.right - 8, y, `行${ri} t3第${li + 1}行右padding`]);
        });
      } else if (ci === 1 && ri !== 0) {
        const y = (c.top + c.bottom) / 2;
        if (c.right - c.textRight > 40) {
          probes.push([c.textRight + (c.right - c.textRight) * 0.5, y, `行${ri} t2文字右侧中部`]);
        }
      }
    });
  });

  for (const [x, y, label] of probes) {
    const r = await clickProbe(x, y, label);
    if (!r.inCell || !r.edFocused) fail++;
    else ok++;
  }
  console.log(`\n${ok} 通过 / ${fail} 失败`);
  await browser.close();
} catch (e) {
  console.error(e);
  await browser.close();
}
