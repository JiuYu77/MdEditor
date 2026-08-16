// repro/test29.mjs —— 复现:点击表格单元格文字/空白区域的光标行为
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
  await sleep(700);

  // 单元格几何 + 文本行信息
  const info = await page.evaluate(() => {
    const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
    const row = rows[2];
    const cells = Array.from(row.querySelectorAll(".md-table-cell"));
    return cells.map((c) => {
      const cr = c.getBoundingClientRect();
      // 文本范围
      const texts = Array.from(c.childNodes).filter((n) => n.nodeType === 3 && n.textContent);
      let minTop = null, maxBottom = null, minLeft = null, maxRight = null;
      texts.forEach((t) => {
        const rng = document.createRange();
        rng.selectNodeContents(t);
        const rr = rng.getBoundingClientRect();
        if (rr.height > 0) {
          if (minTop == null || rr.top < minTop) minTop = rr.top;
          if (maxBottom == null || rr.bottom > maxBottom) maxBottom = rr.bottom;
          if (minLeft == null || rr.left < minLeft) minLeft = rr.left;
          if (maxRight == null || rr.right > maxRight) maxRight = rr.right;
        }
      });
      return {
        text: c.textContent.slice(0, 8),
        cell: { left: Math.round(cr.left), right: Math.round(cr.right), top: Math.round(cr.top), bottom: Math.round(cr.bottom), h: Math.round(cr.height) },
        textBox: minTop != null ? { left: Math.round(minLeft), right: Math.round(maxRight), top: Math.round(minTop), bottom: Math.round(maxBottom) } : null,
        display: getComputedStyle(c).display,
      };
    });
  });
  console.log("单元格几何:", JSON.stringify(info, null, 2));

  const clickAt = async (x, y, label) => {
    await page.mouse.click(x, y);
    await sleep(250);
    const r = await page.evaluate((l) => {
      const sel = window.getSelection();
      const range = sel.rangeCount ? sel.getRangeAt(0) : null;
      const p = range ? range.startContainer : null;
      const el = p && p.nodeType === 3 ? p.parentElement : p;
      // 光标所在单元格
      let cell = null;
      let node = el;
      while (node && node !== document.body) {
        if (node.classList && node.classList.contains("md-table-cell")) { cell = node.className.slice(0, 50); break; }
        node = node.parentElement;
      }
      const cursor = window.__ed.getCursor();
      return { label: l, inCell: cell, headText: p && p.nodeType === 3 ? JSON.stringify(p.textContent) : (p ? p.tagName : null), offset: range ? range.startOffset : -1, cursor };
    }, label);
    console.log(`点击(${Math.round(x)},${Math.round(y)}) ${label}:`, JSON.stringify(r));
  };

  const t3 = info[2];
  if (t3.textBox) {
    // 点击 t3 文字中央
    await clickAt((t3.textBox.left + t3.textBox.right) / 2, (t3.textBox.top + t3.textBox.bottom) / 2, "t3文字中央");
    // 点击 t3 文字上方空白(padding)
    await clickAt((t3.textBox.left + t3.textBox.right) / 2, t3.cell.top + 3, "t3文字上方空白");
    // 点击 t3 文字下方空白
    await clickAt((t3.textBox.left + t3.textBox.right) / 2, t3.cell.bottom - 3, "t3文字下方空白");
    // 点击 t3 文字第一行
    await clickAt((t3.textBox.left + t3.textBox.right) / 2, t3.textBox.top + 8, "t3文字第一行");
  }
  // t1 单行单元格
  const t1 = info[0];
  if (t1.textBox) {
    await clickAt((t1.textBox.left + t1.textBox.right) / 2, (t1.textBox.top + t1.textBox.bottom) / 2, "t1文字中央");
  }
  await browser.close();
} catch (e) {
  console.error(e);
  await browser.close();
}
