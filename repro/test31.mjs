// repro/test31.mjs —— 确定性点击定位:左侧→行首,右侧→行末,文字上→按字符
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
      const p = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
      const el = p && p.nodeType === 3 ? p.parentElement : p;
      let cell = null, node = el;
      while (node && node !== document.body) { if (node.classList && node.classList.contains("md-table-cell")) { cell = true; break; } node = node.parentElement; }
      return { inCell: cell, cursor: window.__ed.getCursor() };
    });
    const ch = await page.evaluate((c) => {
      const row = window.__ed.getValue().split("\n")[c.line - 1];
      return row ? row[c.col - 1] : null;
    }, r.cursor);
    console.log(`${label}: inCell=${r.inCell ? "✓" : "✗"} 光标=行${r.cursor.line}列${r.cursor.col} 字符「${ch}」`);
    return { ...r, ch };
  };

  // 单元格几何:文字逐行 rect + 单元格边界
  const geo = await page.evaluate(() => {
    const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
    return Array.from(rows).map((row) =>
      Array.from(row.querySelectorAll(".md-table-cell")).map((c) => {
        const cr = c.getBoundingClientRect();
        const texts = Array.from(c.childNodes).filter((n) => n.nodeType === 3 && n.textContent);
        const lineRects = [];
        let maxRight = cr.left, minLeft = cr.right;
        texts.forEach((t) => {
          const rng = document.createRange(); rng.selectNodeContents(t);
          Array.from(rng.getClientRects()).forEach((r) => { if (r.width > 0 && r.height > 0) { lineRects.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }); maxRight = Math.max(maxRight, r.right); minLeft = Math.min(minLeft, r.left); } });
        });
        return { left: cr.left, right: cr.right, top: cr.top, bottom: cr.bottom, textLeft: minLeft, textRight: maxRight, lines: lineRects };
      })
    );
  });

  const lastRow = geo[geo.length - 1];
  const t2 = lastRow[1]; // 山东(单行)
  const t3 = lastRow[2]; // 诗句(多行)

  console.log("\n=== t2 山东格(单行): 点击文字左侧/右侧/文字上 ===");
  const y2 = (t2.top + t2.bottom) / 2;
  // 左侧空白(文字左缘往左)
  for (const dx of [-40, -20, -8]) {
    const r = await clickProbe(t2.textLeft + dx, y2, `左${dx}px`);
    check(`左侧${dx}px → 文字开头(列${t2 ? "?" : ""})`, r.ch === "山" || r.cursor.col === 9);
  }
  // 右侧空白
  for (const dx of [8, 20, 40]) {
    const r = await clickProbe(t2.textRight + dx, y2, `右${dx}px`);
    check(`右侧${dx}px → 文字末尾`, r.ch === " " || r.cursor.col === 11);
  }
  // 文字上(中间)
  const rMid = await clickProbe((t2.textLeft + t2.textRight) / 2, y2, "文字中央");
  check("文字中央 → 字符中间", rMid.ch === "山" || rMid.ch === "东");

  console.log("\n=== t3 诗句格(多行): 各行 左侧/右侧 ===");
  if (t3.lines.length > 1) {
    t3.lines.forEach((l, i) => {
      const y = (l.top + l.bottom) / 2;
      clickProbe(l.left - 30, y, `第${i + 1}行左侧30px`);
      clickProbe(l.right + 30, y, `第${i + 1}行右侧30px`);
    });
  } else {
    console.log("(此视口下 t3 单行)");
  }
  await sleep(300);
  console.log(`\n${ok} 通过 / ${fail} 失败`);
  await browser.close();
} catch (e) {
  console.error(e);
  await browser.close();
}
