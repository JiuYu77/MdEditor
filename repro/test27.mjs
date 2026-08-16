// repro/test27.mjs —— 首尾空格隐藏:渲染 0 宽、文档保留、真实点击/输入/对齐行为
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
  await page.setViewport({ width: 1300, height: 900 });
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

  // 1) 渲染:首尾空格被 replace 移除(视觉隐藏),可见文本 = trim 后内容
  const r1 = await page.evaluate(() => {
    const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
    const cell = rows[2].querySelectorAll(".md-table-cell")[1]; // 山东
    // 递归收集可见文本节点(文本在 .md-cell-text 内;空格被 replace 移除无 DOM)
    const texts = [];
    const walk = (n) => {
      if (n.nodeType === 3) { if (n.textContent) texts.push(n); return; }
      n.childNodes.forEach(walk);
    };
    walk(cell);
    let textW = 0;
    texts.forEach((t) => { const rng = document.createRange(); rng.selectNodeContents(t); textW += rng.getBoundingClientRect().width; });
    return {
      textW: Math.round(textW * 10) / 10,
      cellW: Math.round(cell.getBoundingClientRect().width),
      docRow2: window.__ed.getValue().split("\n")[2],
      docRow4: window.__ed.getValue().split("\n")[4],
    };
  });
  console.log("1) 可见文本宽:", r1.textW, " 文档行2:", JSON.stringify(r1.docRow2));
  check("首尾空格渲染隐藏(可见文本=山东)", r1.textW >= 26 && r1.textW < 35, "textW=" + r1.textW);
  check("文档保留左右空格", r1.docRow2.includes("| 的的 |") && r1.docRow4.includes("| sdf | 山东 |"));
  check("列宽按 trim 内容(山东列<270)", r1.cellW < 270, "w=" + r1.cellW);

  // 2) 真实点击 山东 文本末尾 → 输入! → 得 "山东!"(空格保持在末尾被隐藏)
  const pos = await page.evaluate(() => {
    const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
    const row = rows[2];
    const cell = row.querySelectorAll(".md-table-cell")[1];
    const r = cell.getBoundingClientRect();
    return { x: r.left + 16 + 28, y: (r.top + r.bottom) / 2 };
  });
  await page.mouse.click(pos.x, pos.y);
  await sleep(250);
  await page.keyboard.type("!");
  await sleep(250);
  const r2 = await page.evaluate(() => window.__ed.getValue().split("\n")[4].slice(0, 24));
  console.log("2) 点击末尾输入! →", JSON.stringify(r2));
  check("输入在空格前(山东!)", r2.includes("山东!") && !r2.includes("山东 !"));

  // 3) 再输入空格 → 渲染隐藏(可见文本不含尾随空格)、文档保留
  await page.keyboard.type("  ");
  await sleep(250);
  const r3 = await page.evaluate(() => {
    const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
    const cell = rows[2].querySelectorAll(".md-table-cell")[1];
    const texts = [];
    const walk = (n) => {
      if (n.nodeType === 3) { if (n.textContent) texts.push(n); return; }
      n.childNodes.forEach(walk);
    };
    walk(cell);
    let textW = 0;
    texts.forEach((t) => { const rng = document.createRange(); rng.selectNodeContents(t); textW += rng.getBoundingClientRect().width; });
    return { textW: Math.round(textW), doc: window.__ed.getValue().split("\n")[4].slice(0, 26) };
  });
  console.log("3) 输入空格后: 可见文本宽=", r3.textW, " 文档=", JSON.stringify(r3.doc));
  check("尾随空格仍隐藏(文本宽不变)", r3.textW <= 36);
  check("文档保留新空格", r3.doc.includes("山东!  "));

  // 4) 中间空格保留显示("22 ss")
  const r4 = await page.evaluate(() => {
    const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
    const cell = rows[1].querySelectorAll(".md-table-cell")[1];
    const texts = [];
    const walk = (n) => {
      if (n.nodeType === 3) { if (n.textContent) texts.push(n); return; }
      n.childNodes.forEach(walk);
    };
    walk(cell);
    let textW = 0;
    texts.forEach((t) => { const rng = document.createRange(); rng.selectNodeContents(t); textW += rng.getBoundingClientRect().width; });
    return Math.round(textW);
  });
  console.log("4) '22 ss' 可见文本宽:", r4);
  check("中间空格保留显示(宽度>32)", r4 > 32, "w=" + r4);

  // 5) 点击单元格右空白 → 对齐本列(不跑到下一列)
  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(400);
  const rect = await page.evaluate(() => {
    const rows = document.querySelectorAll("#editor .cm-line.md-table-row");
    const cell = rows[2].querySelectorAll(".md-table-cell")[1];
    const r = cell.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  await page.mouse.click(rect.left + (rect.right - rect.left) * 0.8, (rect.top + rect.bottom) / 2);
  await sleep(200);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".md-table-toolbar button"));
    const b = btns.find((x) => x.title === "列居中");
    if (b) b.click();
  });
  await sleep(300);
  const r5 = await page.evaluate(() => window.__ed.getValue().split("\n")[1]);
  console.log("5) 点击山东格右空白→居中:", JSON.stringify(r5));
  check("对齐作用于本列", r5.includes("| :--- | :---: | --- |"));

  console.log(`\n${ok} 通过 / ${fail} 失败`);
} finally {
  await browser.close();
}
