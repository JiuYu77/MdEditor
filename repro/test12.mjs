// repro/test12.mjs —— 空列表项渲染圆点 + 空项回车退出列表
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:1420/repro/test9.html";
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
let ok = 0, fail = 0;
const check = (name, c, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"}  ${name}${extra ? "  [" + extra + "]" : ""}`);
  c ? ok++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__ed, { timeout: 20000 });

  const doc = ["- [x] 山东泰安", "  - 泰山", "  - 方特", "- [x] 山东济南"].join("\n");
  const dumpDoc = () => page.evaluate(() => window.__ed.getValue().split("\n").map((l, i) => i + ":" + JSON.stringify(l)).join(" | "));
  const dumpDom = () => page.evaluate(() => Array.from(document.querySelectorAll("#editor .cm-line")).map((l, i) => i + ":" + JSON.stringify(l.textContent.slice(0, 16))).join(" | "));

  // U1: 方特末尾回车 → 空列表项渲染圆点（光标移开该行后检查渲染）
  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(400);
  await page.evaluate(() => {
    const lines = window.__ed.getValue().split("\n");
    let pos = 0;
    for (let i = 0; i < 2; i++) pos += lines[i].length + 1;
    pos += lines[2].length;
    window.__ed.setCursor(pos, false);
    window.__ed.focus();
  });
  await sleep(250);
  await page.keyboard.press("Enter");
  await sleep(350);
  await page.evaluate(() => { window.__ed.setCursor(0, false); }); // 移开光标
  await sleep(350);
  console.log("U1 doc:", await dumpDoc());
  console.log("U1 DOM:", await dumpDom());
  const u1dom = await dumpDom();
  check("空列表项渲染圆点（• 而非裸 -）", u1dom.includes('"  • "'));

  // U2: 空项上回车 → 空行（不再是 - [ ] ）
  await page.evaluate(() => {
    const lines = window.__ed.getValue().split("\n");
    let pos = 0;
    for (let i = 0; i < 3; i++) pos += lines[i].length + 1; // 跳过前 3 行到空项行
    pos += lines[3].length;
    window.__ed.setCursor(pos, false);
    window.__ed.focus();
  });
  await sleep(250);
  await page.keyboard.press("Enter");
  await sleep(350);
  const u2doc = await dumpDoc();
  console.log("U2 doc:", u2doc);
  check("空项回车退出列表得到空行", u2doc.includes('3:""') && !u2doc.includes('3:"- [ ] "'));

  // A1/A2: 任务项回车续行 + 再回车退出
  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(400);
  await page.evaluate(() => { window.__ed.setCursor(window.__ed.getValue().length, false); window.__ed.focus(); });
  await sleep(250);
  await page.keyboard.press("Enter");
  await sleep(350);
  const a1doc = await dumpDoc();
  console.log("A1 doc:", a1doc);
  check("任务项回车 → - [ ] 续行", a1doc.includes('4:"- [ ] "'));
  await page.keyboard.press("Enter");
  await sleep(350);
  const a2doc = await dumpDoc();
  console.log("A2 doc:", a2doc);
  check("空任务项回车 → 空行", a2doc.includes('4:""'));

  // 独立 "-" 文档（无前文）：保留原样显示
  await page.evaluate(() => window.__ed.setValue("-"));
  await sleep(400);
  const loneDom = await dumpDom();
  console.log("lone-dash DOM:", loneDom);
  check("单独 - 保留原样", loneDom.includes('"-"') && !loneDom.includes("•"));

  console.log(`\n${ok} 通过 / ${fail} 失败`);
} finally {
  await browser.close();
}
