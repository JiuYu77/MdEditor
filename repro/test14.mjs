// repro/test14.mjs —— 表格聚焦渲染 + 浮动操作按钮验证
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

  const doc = ["| t1 | t2 |", "| :--- | ---: |", "| 11 是否 | 22 |", "| sdf | 山东 |", "", "结尾"].join("\n");
  const dumpDoc = () => page.evaluate(() => window.__ed.getValue());
  const clickBtn = () =>
    page.evaluate(() => {
      // 工具条「更多表格操作」按钮打开菜单
      const btns = Array.from(document.querySelectorAll(".md-table-toolbar button"));
      const more = btns.find((b) => b.title === "更多表格操作") || btns[btns.length - 1];
      more.click();
    });
  const clickMenuItem = async (label) => {
    await clickBtn();
    await sleep(150);
    await page.evaluate((l) => {
      const items = Array.from(document.querySelectorAll(".md-table-menu-item"));
      const item = items.find((b) => b.textContent === l);
      if (item && !item.disabled) item.click();
    }, label);
    await sleep(300);
  };
  const cursorToLine = async (line) => {
    await page.evaluate((ln) => {
      const lines = window.__ed.getValue().split("\n");
      let pos = 0;
      for (let i = 0; i < ln - 1; i++) pos += lines[i].length + 1;
      window.__ed.setCursor(pos, false);
      window.__ed.focus();
    }, line);
    await sleep(300);
  };

  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(500);

  // 1) 光标在表格数据行 -> 保持渲染 + 浮动按钮出现
  await cursorToLine(3);
  const r1 = await page.evaluate(() => {
    const lines = document.querySelectorAll("#editor .cm-line");
    const row = lines[2];
    const btn = document.querySelector(".md-table-toolbar");
    return {
      rowText: row.textContent.slice(0, 16),
      hasCells: !!row.querySelector(".md-table-cell"),
      cursorSource: row.classList.contains("md-cursor-source"),
      btnShown: !!btn && getComputedStyle(btn).display !== "none",
    };
  });
  console.log("1) 光标在数据行:", JSON.stringify(r1));
  check("光标行保持渲染（无源码、无源码底色）", r1.hasCells && !r1.cursorSource && !r1.rowText.includes("| 11 是否 |"));
  check("浮动按钮显示", r1.btnShown);

  // 2) 对齐跟随分隔行冒号
  const r2 = await page.evaluate(() => {
    const lines = document.querySelectorAll("#editor .cm-line");
    const cells = Array.from(lines[2].querySelectorAll(".md-table-cell"));
    return cells.map((c) => c.className.match(/md-table-align-([lcr])/)?.[1] ?? "?");
  });
  console.log("2) 对齐类:", JSON.stringify(r2));
  check("第1列左、第2列右对齐", r2[0] === "l" && r2[1] === "r");

  // 3) 菜单完整性（对齐已从菜单移除，只留工具条快捷按钮）
  await clickBtn();
  await sleep(150);
  const menuItems = await page.evaluate(() => Array.from(document.querySelectorAll(".md-table-menu-item")).map((b) => b.textContent));
  console.log("3) 菜单项:", JSON.stringify(menuItems));
  check("菜单项完整（8 项、无对齐项）", menuItems.length === 8 && !menuItems.some((t) => t.includes("对齐")));

  // 4) 在下方插入行
  await clickMenuItem("在下方插入行");
  let docV = await dumpDoc();
  console.log("4) 插入行后:\n" + docV);
  check("在下方插入行", docV.includes("| 11 是否 | 22 |\n|  |  |"));

  // 5) 删除该新行
  await cursorToLine(4);
  await clickMenuItem("删除当前行");
  docV = await dumpDoc();
  check("删除当前行", !docV.includes("|  |  |"));

  // 6) 在右侧插入列
  await cursorToLine(3);
  await clickMenuItem("在右侧插入列");
  docV = await dumpDoc();
  console.log("6) 插入列后:\n" + docV);
  check("在右侧插入列", docV.includes("| t1 |  | t2 |") && docV.includes("| :--- | --- | ---: |"));

  // 7) 删除当前列（重置后光标第 3 行列 0）
  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(400);
  await cursorToLine(3);
  await clickMenuItem("删除当前列");
  docV = await dumpDoc();
  console.log("7) 删除当前列后:\n" + docV);
  check("删除当前列", !docV.includes("| t1 |"));

  // 8) 复制表格
  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(400);
  await cursorToLine(3);
  await page.evaluate(() => {
    window.__copied = "";
    navigator.clipboard.writeText = async (t) => { window.__copied = t; };
  });
  await clickMenuItem("复制表格");
  const copied = await page.evaluate(() => window.__copied || "");
  console.log("8) 剪贴板:", JSON.stringify((copied || "").slice(0, 40)));
  check("复制表格", (copied || "").includes("| t1 | t2 |"));

  // 9) 列居中（工具条快捷按钮）
  await page.evaluate((d) => window.__ed.setValue(d), doc);
  await sleep(400);
  await cursorToLine(3);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".md-table-toolbar button"));
    const center = btns.find((b) => b.title === "列居中");
    if (center) center.click();
  });
  await sleep(300);
  docV = await dumpDoc();
  console.log("9) 列居中后分隔行:", JSON.stringify(docV.split("\n")[1]));
  check("列居中（:--- -> :---:）", docV.includes("| :---: | ---: |"));

  // 10) 删除表格
  await clickMenuItem("删除表格");
  docV = await dumpDoc();
  console.log("10) 删除表格后:\n" + docV);
  check("删除表格", !docV.includes("| t1 |"));

  console.log(`\n${ok} 通过 / ${fail} 失败`);
} finally {
  await browser.close();
}
