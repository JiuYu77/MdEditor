// repro/test36.mjs —— 多行单元格末行点击(无闪烁)+ 光标高度稳定
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

  // 定位 t3 单元格(最后一行,多行)的逐行文字 rect
  const lines = await page.evaluate(() => {
    const row = document.querySelectorAll("#editor .cm-line.md-table-row")[2];
    const cell = row.querySelectorAll(".md-table-cell")[2];
    const textNodes = [];
    const walk = (n) => {
      if (n.nodeType === 3) { if (n.textContent) textNodes.push(n); return; }
      n.childNodes.forEach(walk);
    };
    walk(cell);
    const rects = [];
    textNodes.forEach((t) => {
      const rng = document.createRange(); rng.selectNodeContents(t);
      Array.from(rng.getClientRects()).forEach((r) => {
        if (r.width > 0 && r.height > 0) rects.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width });
      });
    });
    return rects;
  });
  console.log("t3 逐行:", lines.map((l) => Math.round(l.top) + "-" + Math.round(l.bottom)).join(" | "));
  const last = lines[lines.length - 1];

  // 点击最后一行文字中央:检查 mousedown 后光标是否立即正确(无闪烁 = 位置对)
  const y = (last.top + last.bottom) / 2;
  const x = last.left + last.w * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await sleep(80); // mousedown 后立即读光标
  const during = await page.evaluate(() => {
    const cur = window.__ed.getCursor();
    const row = window.__ed.getValue().split("\n")[cur.line - 1];
    return { line: cur.line, col: cur.col, char: row ? row[cur.col - 1] : null };
  });
  console.log("mousedown 时光标:", JSON.stringify(during));
  // 末行文字应位于文档后段(行4 的 col >= 32 附近,"月照花林"之后)
  check("mousedown 即落在最后一行(非上一行)", during.line === 5 && during.col >= 32, "col=" + during.col);
  await page.mouse.up();
  await sleep(200);
  const after = await page.evaluate(() => window.__ed.getCursor());
  check("mouseup 后光标不变(无闪跳)", after.line === 5 && after.col === during.col, JSON.stringify(after));

  // 光标高度:点击文字上 vs 行末,应一致且 >= 14
  const heights = [];
  const probe = async (px, py, label) => {
    await page.mouse.click(px, py);
    await sleep(250);
    const h = await page.evaluate(() => {
      const cur = document.querySelector("#editor .cm-cursor");
      return cur ? Math.round(cur.getBoundingClientRect().height) : null;
    });
    heights.push({ label, h });
    console.log(label + " caretH=" + h);
  };
  await probe((last.left + last.right) / 2, y, "末行文字中央");
  // 最后一行右侧空白
  await probe(last.right + 20, y, "末行右侧空白");
  // 单元格右 padding
  const cellRight = await page.evaluate(() => {
    const row = document.querySelectorAll("#editor .cm-line.md-table-row")[2];
    return row.querySelectorAll(".md-table-cell")[2].getBoundingClientRect().right;
  });
  await probe(cellRight - 5, y, "单元格右padding");
  const hs = heights.map((h) => h.h);
  check("光标高度 ≥ 文字高度(14)", hs.every((h) => h >= 14), JSON.stringify(hs));
  check("光标高度一致(差 ≤ 2)", Math.max(...hs) - Math.min(...hs) <= 2, JSON.stringify(hs));

  console.log(`\n${ok} 通过 / ${fail} 失败`);
} finally {
  await browser.close();
}
