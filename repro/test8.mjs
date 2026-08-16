// repro/test8.mjs —— 代码块完整功能验证（v2：posAtCoords 定位）
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "log") console.log(`[${m.type()}]`, m.text()); });
  await page.goto("http://localhost:1420/repro/test8.html", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__codeState, { timeout: 20000 });

  const doc = "```c\n#include <stdio.h>\nint main() {\n  return 0;\n}\n```";
  await page.evaluate((d) => window.__setValue(d), doc);
  await new Promise((r) => setTimeout(r, 1500)); // 等待渲染稳定

  console.log("=== 代码块渲染 ===");
  const st = await page.evaluate(() => window.__codeState());
  st.forEach((l, i) => console.log(`行${i + 1}: cls=${l.cls.split(" ").slice(1).join("+")} tok=${JSON.stringify(l.tok)} toolbar=${l.toolbar} copy=${l.copyBtn}`));

  console.log("\n高亮（初始 1.5s 后）:", JSON.stringify(await page.evaluate(() => window.__treeDump())));
  // 最小对照实验：纯 codeLanguages 是否挂载 C 语言
  await new Promise((r) => setTimeout(r, 2000));
  console.log("对照实验树:", await page.evaluate(() => window.__minTree()));
  console.log("对照实验 ͼ类:", await page.evaluate(() => window.__minClasses()));
  console.log("对照2 单独 StreamLanguage(C) ͼ类:", await page.evaluate(() => window.__cClasses()));
  // 事务触发后重查
  await page.evaluate(() => window.__minTrigger());
  await new Promise((r) => setTimeout(r, 1500));
  console.log("触发后树:", await page.evaluate(() => window.__minTree()));
  console.log("触发后 tok:", await page.evaluate(() => window.__minTok()));
  // 触发一个事务（移动光标），等待嵌套语言重解析
  await page.evaluate(() => window.__moveCursor(4));
  await new Promise((r) => setTimeout(r, 1200));
  console.log("高亮（光标移动后）:", JSON.stringify(await page.evaluate(() => window.__treeDump())));

  // 语言切换：python
  await page.evaluate(() => window.__clickToolbar(1));
  await new Promise((r) => setTimeout(r, 60));
  const pickerOpen = await page.evaluate(() => window.__langPickerOpen());
  await page.evaluate(() => window.__clickLangItem(5)); // python
  await new Promise((r) => setTimeout(r, 200));
  console.log("\n语言弹层打开:", pickerOpen, "| 切换后 value:", JSON.stringify(await page.evaluate(() => window.__value())));

  // 折叠
  await page.evaluate(() => window.__clickToolbar(0));
  await new Promise((r) => setTimeout(r, 200));
  const ph = await page.evaluate(() => window.__foldPlaceholder());
  const visLines = (await page.evaluate(() => window.__codeState())).length;
  console.log("\n折叠后 placeholder:", ph, "| 可见行数:", visLines);

  // 展开（点占位）
  if (ph) {
    await page.evaluate(() => document.querySelector(".cm-foldPlaceholder").click());
    await new Promise((r) => setTimeout(r, 200));
    console.log("展开后可见行数:", (await page.evaluate(() => window.__codeState())).length);
  }

  // 复制
  await page.evaluate(() => window.__clickToolbar(2));
  await new Promise((r) => setTimeout(r, 100));
  console.log("\n复制按钮点击完成");

  console.log("\n页面错误日志:", (await page.evaluate(() => window.__logs())).split("\n").filter((l) => l.includes("error")).join("; ") || "无");
} finally {
  await browser.close();
}
