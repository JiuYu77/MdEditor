// repro/test13.mjs —— 列表回车续行（无多余空行）+ 空项退出 + 有序 +1
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

  const dump = () => page.evaluate(() => window.__ed.getValue().split("\n").map((l, i) => i + ":" + JSON.stringify(l)).join(" | "));
  const cursorToLineEnd = async (lineIdx) => {
    await page.evaluate((idx) => {
      const lines = window.__ed.getValue().split("\n");
      let pos = 0;
      for (let i = 0; i < idx; i++) pos += lines[i].length + 1;
      pos += lines[idx].length;
      window.__ed.setCursor(pos, false);
      window.__ed.focus();
    }, lineIdx);
    await sleep(250);
  };
  const pressEnter = async () => {
    await page.keyboard.press("Enter");
    await sleep(300);
  };

  // 1) 松散列表：泰山后回车 → 直接 "- " 续行，无多余空行
  await page.evaluate(() => window.__ed.setValue(["## 山东泰安", "", "- 泰山", "", "- 方特", "", "## 山东济南"].join("\n")));
  await sleep(400);
  await cursorToLineEnd(2); // "- 泰山"
  await pressEnter();
  const r1 = await dump();
  console.log("松散列表回车:", r1);
  check("松散列表续行无多余空行", r1.includes('3:"- "') && !r1.includes('2:"- 泰山" | 3:"" | 4:"- "'));

  // 2) 任务列表（真实文件第 22 行 "- [ ] sdf " 带尾随空格）
  await page.evaluate(() => window.__ed.setValue(["- [ ] sdf ", "- [x] sdf ", "- [x] sdf"].join("\n")));
  await sleep(400);
  await cursorToLineEnd(1); // "- [x] sdf "
  await pressEnter();
  const r2 = await dump();
  console.log("任务列表回车:", r2);
  check("任务项回车 → - [ ] 续行（无空行）", r2.includes('2:"- [ ] "'));

  // 3) 有序列表 1. → 2.
  await page.evaluate(() => window.__ed.setValue(["1. 大江东去浪淘尽", "2. 千古风流人物"].join("\n")));
  await sleep(400);
  await cursorToLineEnd(0);
  await pressEnter();
  const r3 = await dump();
  console.log("有序列表回车:", r3);
  check("有序列表续行数字 +1", r3.includes('1:"2. "'));

  // 4) 空列表项回车 → 退出列表（空行）
  await page.evaluate(() => window.__ed.setValue(["- 泰山", "- ", "- 方特"].join("\n")));
  await sleep(400);
  await cursorToLineEnd(1); // "- "
  await pressEnter();
  const r4 = await dump();
  console.log("空项回车:", r4);
  check("空列表项回车 → 空行", r4.includes('1:""'));

  // 5) 引用续行仍由默认处理（> ）
  await page.evaluate(() => window.__ed.setValue(["> 引用", "> 第二行"].join("\n")));
  await sleep(400);
  await cursorToLineEnd(0);
  await pressEnter();
  const r5 = await dump();
  console.log("引用回车:", r5);
  check("引用续行 > 仍有效", r5.includes('1:"> "'));

  // 6) 嵌套子列表续行保持缩进
  await page.evaluate(() => window.__ed.setValue(["- 泰山", "  - 方特", "  - 双方"].join("\n")));
  await sleep(400);
  await cursorToLineEnd(1);
  await pressEnter();
  const r6 = await dump();
  console.log("嵌套子列表回车:", r6);
  check("子列表续行保持缩进", r6.includes('2:"  - "'));

  console.log(`\n${ok} 通过 / ${fail} 失败`);
} finally {
  await browser.close();
}
