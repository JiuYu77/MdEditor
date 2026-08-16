// repro/test37.mjs —— 换行单元格最后一行:点击文字/右侧空白的定位
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

  // t3 第2行单元格("春江潮水...")的逐行文字 rect + 单元格边界
  const geo = await page.evaluate(() => {
    const row = document.querySelectorAll("#editor .cm-line.md-table-row")[1];
    const cell = row.querySelectorAll(".md-table-cell")[2];
    const cr = cell.getBoundingClientRect();
    // 递归收集可见文本节点(文本在 .md-cell-text 内)
    const textNodes = [];
    const walk = (n) => {
      if (n.nodeType === 3) { if (n.textContent) textNodes.push(n); return; }
      n.childNodes.forEach(walk);
    };
    walk(cell);
    const lineRects = [];
    textNodes.forEach((t) => {
      const rng = document.createRange(); rng.selectNodeContents(t);
      Array.from(rng.getClientRects()).forEach((r) => {
        if (r.width > 0 && r.height > 0) lineRects.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width });
      });
    });
    return { cell: { left: cr.left, right: cr.right, top: cr.top, bottom: cr.bottom }, lines: lineRects };
  });
  console.log("t3第2行 单元格:", JSON.stringify(geo.cell), "逐行:", JSON.stringify(geo.lines.map((l) => ({ t: Math.round(l.top), b: Math.round(l.bottom), l: Math.round(l.left), r: Math.round(l.right) }))));

  const clickProbe = async (x, y, label) => {
    await page.mouse.click(x, y);
    await sleep(250);
    const r = await page.evaluate(() => {
      const cur = window.__ed.getCursor();
      const row = window.__ed.getValue().split("\n")[cur.line - 1];
      return { line: cur.line, col: cur.col, char: row ? row[cur.col - 1] : null, next: row ? row[cur.col] : null };
    });
    console.log(`${label} (${Math.round(x)},${Math.round(y)}): 光标=行${r.line}列${r.col} 前字符「${r.char}」后字符「${r.next}」`);
    return r;
  };

  const last = geo.lines[geo.lines.length - 1];
  const y = (last.top + last.bottom) / 2;

  // 点击最后一行文字末尾(最后一个字符"生"上)
  await clickProbe(last.right - 2, y, "末行最后一个字符");
  // 点击最后一行文字右侧空白(+10/+30/+80)
  const gap = geo.cell.right - last.right - 16;
  for (const f of [0.1, 0.3, 0.8]) {
    await clickProbe(last.right + gap * f, y, `末行右侧空白${Math.round(f * 100)}%`);
  }
  // 单元格右 padding
  await clickProbe(geo.cell.right - 5, y, "单元格右padding");
  // 点击后输入,看插入位置
  await page.mouse.click(last.right + gap * 0.3, y);
  await sleep(250);
  await page.keyboard.type("!");
  await sleep(250);
  const docV = await page.evaluate(() => window.__ed.getValue().split("\n")[3]);
  console.log("点击末行右侧输入! 文档行3:", JSON.stringify(docV));

  // 断言:末行右侧点击 → 光标在文字末尾(单行 col≈31 / 多行 col≈56),且渲染贴近文字(非单元格右缘)
  const r = await clickProbe(last.right + gap * 0.3, y, "末行右侧30%");
  check("末行右侧点击定位到文字末尾", r.line === 4 && r.col >= 28 && r.col <= 57, "col=" + r.col);
  const renderX = await page.evaluate(() => {
    const c = document.querySelector("#editor .cm-cursor");
    return c ? Math.round(c.getBoundingClientRect().left) : null;
  });
  check("光标渲染贴近文字(距右缘>40px)", renderX != null && geo.cell.right - renderX > 40, "renderX=" + renderX + " cellRight=" + Math.round(geo.cell.right));
  console.log(`\n${ok} 通过 / ${fail} 失败`);
} finally {
  await browser.close();
}
