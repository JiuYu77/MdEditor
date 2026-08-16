// repro/test33.mjs —— 复现:t3 列第2行单元格 文字/右侧空白 点击聚焦
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

  // 获取 t3 第2行单元格(第2个数据行)几何
  const geo = await page.evaluate(() => {
    const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
    const row = rows[1]; // 第2个数据行(是否行)
    const cell = row.querySelectorAll(".md-table-cell")[2];
    const cr = cell.getBoundingClientRect();
    const textNodes = [];
    const walk = (n) => {
      if (n.nodeType === 3) { if (n.textContent) textNodes.push(n); return; }
      n.childNodes.forEach(walk);
    };
    walk(cell);
    let textLeft = cr.right, textRight = cr.left;
    textNodes.forEach((t) => {
      const rng = document.createRange(); rng.selectNodeContents(t);
      Array.from(rng.getClientRects()).forEach((r) => {
        if (r.width > 0 && r.height > 0) {
          textLeft = Math.min(textLeft, r.left);
          textRight = Math.max(textRight, r.right);
        }
      });
    });
    return {
      cell: { left: cr.left, right: cr.right, top: cr.top, bottom: cr.bottom },
      textLeft, textRight,
      cellW: cr.width,
    };
  });
  console.log("t3第2行单元格:", JSON.stringify(geo, null, 2));

  const clickProbe = async (x, y, label) => {
    await page.mouse.click(x, y);
    await sleep(250);
    const r = await page.evaluate((l) => {
      const sel = window.getSelection();
      const range = sel.rangeCount ? sel.getRangeAt(0) : null;
      const p = range ? range.startContainer : null;
      const el = p && p.nodeType === 3 ? p.parentElement : p;
      let cell = null, node = el;
      while (node && node !== document.body) { if (node.classList && node.classList.contains("md-table-cell")) { cell = node.className.slice(0, 30); break; } node = node.parentElement; }
      const ed = document.querySelector("#editor");
      const cur = document.querySelector("#editor .cm-cursor");
      const curR = cur ? cur.getBoundingClientRect() : null;
      return {
        label: l,
        inCell: cell,
        cursor: window.__ed.getCursor(),
        focused: ed === document.activeElement || !!ed.querySelector(".cm-focused"),
        caretH: curR ? Math.round(curR.height) : null,
        caretVisible: cur ? getComputedStyle(cur).display !== "none" && curR.width > 0 && curR.height > 0 : false,
      };
    }, label);
    console.log(`${label} (${Math.round(x)},${Math.round(y)}): inCell=${r.inCell ? "✓" : "✗"} 光标=行${r.cursor.line}列${r.cursor.col} focused=${r.focused} caretH=${r.caretH} caretVisible=${r.caretVisible}`);
  };

  const y = (geo.cell.top + geo.cell.bottom) / 2;
  // 文字中央
  await clickProbe((geo.textLeft + geo.textRight) / 2, y, "文字中央");
  // 文字右侧空白(文字右缘 → 单元格右缘 之间 25%/50%/80%)
  const gap = geo.cell.right - geo.textRight - 16;
  for (const f of [0.25, 0.5, 0.8]) {
    await clickProbe(geo.textRight + gap * f, y, `文字右侧空白${Math.round(f * 100)}%`);
  }
  // 单元格右 padding
  await clickProbe(geo.cell.right - 5, y, "单元格右padding");
  // 点击后输入字符,看进入哪个格
  await page.mouse.click(geo.textRight + gap * 0.5, y);
  await sleep(250);
  await page.keyboard.type("!");
  await sleep(250);
  const docV = await page.evaluate(() => window.__ed.getValue().split("\n")[3]);
  console.log("点击右侧空白后输入! 文档:", JSON.stringify(docV.slice(0, 30)));
  await browser.close();
} catch (e) {
  console.error(e);
  await browser.close();
}
