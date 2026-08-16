// repro/test32.mjs —— 右侧点击光标可见性 + 拖选高亮
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
  await page.setViewport({ width: 900, height: 900 });
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

  // 1) 点击 t2 山东格 右侧空白 → 光标位置 + caret DOM 可见性 + 编辑器焦点
  const geo = await page.evaluate(() => {
    const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
    const row = rows[rows.length - 1];
    const cells = Array.from(row.querySelectorAll(".md-table-cell")).map((c) => {
      const cr = c.getBoundingClientRect();
      const texts = Array.from(c.childNodes).filter((n) => n.nodeType === 3 && n.textContent);
      let textRight = cr.left;
      texts.forEach((t) => { const rng = document.createRange(); rng.selectNodeContents(t); Array.from(rng.getClientRects()).forEach((r) => { if (r.width > 0 && r.height > 0) textRight = Math.max(textRight, r.right); }); });
      return { left: cr.left, right: cr.right, top: cr.top, bottom: cr.bottom, textRight };
    });
    return { t2: cells[1], t3: cells[2] };
  });

  const y2 = (geo.t2.top + geo.t2.bottom) / 2;
  for (const f of [0.3, 0.6, 0.9]) {
    const x = geo.t2.textRight + (geo.t2.right - geo.t2.textRight - 16) * f;
    await page.mouse.click(x, y2);
    await sleep(250);
    const r = await page.evaluate(() => {
      const ed = document.querySelector("#editor");
      const cur = document.querySelector("#editor .cm-cursor");
      const curR = cur ? cur.getBoundingClientRect() : null;
      return {
        cursor: window.__ed.getCursor(),
        focused: ed === document.activeElement || !!ed.querySelector(".cm-focused"),
        caretEl: cur ? { left: Math.round(curR.left), w: curR.width, h: curR.height, cls: cur.className.slice(0, 40) } : null,
        caretVisible: cur ? getComputedStyle(cur).display !== "none" && curR.width > 0 : false,
      };
    });
    console.log(`点击t2右侧${Math.round(f * 100)}%: 光标=行${r.cursor.line}列${r.cursor.col} focused=${r.focused} caretVisible=${r.caretVisible} caret=${JSON.stringify(r.caretEl)}`);
  }

  // 2) 拖选测试:在 t3 单元格文字上按下并拖动 → 检查 selection + 高亮
  const t3y = (geo.t3.top + geo.t3.bottom) / 2;
  const x1 = geo.t3.left + 20, x2 = geo.t3.right - 30;
  await page.mouse.move(x1, t3y);
  await page.mouse.down();
  await page.mouse.move(x2, t3y, { steps: 8 });
  await sleep(200);
  await page.mouse.up();
  await sleep(300);
  const sel = await page.evaluate(() => {
    const s = window.getSelection();
    const r = s.rangeCount ? s.getRangeAt(0) : null;
    const selBg = document.querySelector("#editor .cm-selectionBackground, #editor .cm-selectionText, #editor .ͼ1 .cm-selectionBackground, #editor span.cm-selectionBackground");
    return {
      text: r ? r.toString().slice(0, 20) : null,
      collapsed: r ? r.collapsed : true,
      selBgCount: document.querySelectorAll("#editor .cm-selectionBackground, #editor .cm-selectionText, #editor .cm-selectionLayer span").length,
      stateSel: window.__ed.getSelection().slice(0, 20),
      selBgEl: selBg ? selBg.className : null,
    };
  });
  console.log("\n拖选结果:", JSON.stringify(sel, null, 2));

  // 3) 点击文字本身(非空白)后拖选
  await page.mouse.move(x1, t3y);
  await page.mouse.down();
  await page.mouse.move(geo.t3.left + 150, t3y, { steps: 6 });
  await sleep(150);
  await page.mouse.up();
  await sleep(300);
  const sel2 = await page.evaluate(() => {
    const s = window.getSelection();
    const r = s.rangeCount ? s.getRangeAt(0) : null;
    return {
      text: r ? r.toString().slice(0, 16) : null,
      collapsed: r ? r.collapsed : true,
      selBgCount: document.querySelectorAll("#editor .cm-selectionLayer span, #editor .cm-selectionBackground").length,
    };
  });
  console.log("\n文字上拖选结果:", JSON.stringify(sel2));
  await browser.close();
} catch (e) {
  console.error(e);
  await browser.close();
}
