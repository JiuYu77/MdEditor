// repro/test10.mjs —— 外部文件变化检测验证（轮询 + 刷新按钮）
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  [" + extra + "]" : ""}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 140)));
  await page.goto("http://localhost:5174/repro/test10.html", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__treeNames, { timeout: 20000 });
  await page.waitForFunction(() => window.__treeNames().length > 0, { timeout: 10000 });

  console.log("=== 1) 标题 / 按钮 ===");
  const title = await page.evaluate(() => window.__headerTitle());
  check("header 无 ': 子目录' 后缀", title === "文件资源管理器", JSON.stringify(title));
  check("关闭按钮已移除", !(await page.evaluate(() => window.__hasClose())));
  const rb = await page.evaluate(() => window.__refreshBtn());
  check("刷新按钮存在（fa-arrows-rotate）", rb.exists && rb.title === "刷新", JSON.stringify(rb));

  console.log("\n=== 2) 外部变化轮询（系统文件管理器新建）===");
  const before = await page.evaluate(() => window.__treeNames());
  console.log("  变化前:", JSON.stringify(before));
  await page.evaluate(() => {
    window.__setDir("/ws", [
      { name: "docs", is_dir: true },
      { name: "app.js", is_dir: false },
      { name: "other.md", is_dir: false },
      { name: "config.yml", is_dir: false },
      { name: "photo.png", is_dir: false },
      { name: "external-new.md", is_dir: false },
    ]);
  });
  await sleep(3600); // 轮询间隔 3s
  const after = await page.evaluate(() => window.__treeNames());
  console.log("  变化后:", JSON.stringify(after));
  check("轮询检测到外部新建文件", after.includes("external-new.md"), "");

  console.log("\n=== 3) 刷新按钮（外部删除 → 立即刷新）===");
  await page.evaluate(() => {
    window.__setDir("/ws", [
      { name: "docs", is_dir: true },
      { name: "app.js", is_dir: false },
      { name: "other.md", is_dir: false },
      { name: "config.yml", is_dir: false },
      { name: "photo.png", is_dir: false },
    ]);
  });
  await page.evaluate(() => window.__clickRefresh());
  await sleep(400);
  const afterRefresh = await page.evaluate(() => window.__treeNames());
  check("刷新按钮后 external-new.md 消失", !afterRefresh.includes("external-new.md"), JSON.stringify(afterRefresh));
  check("刷新计数为 1", (await page.evaluate(() => window.__refreshCount())) === 1);

  console.log("\n=== 4) 展开目录的外部变化轮询 ===");
  await page.evaluate(() => window.__expandDir("docs"));
  await sleep(500);
  const docsBefore = await page.evaluate(() => window.__treeNames());
  console.log("  展开后 docs 子项:", JSON.stringify(docsBefore.filter((n) => n !== "docs")));
  await page.evaluate(() => {
    window.__setDir("/ws/docs", [
      { name: "readme.md", is_dir: false },
      { name: "notes", is_dir: true },
      { name: "external-nested.md", is_dir: false },
    ]);
  });
  await sleep(3600);
  const docsAfter = await page.evaluate(() => window.__treeNames());
  check("展开目录轮询检测到嵌套新建", docsAfter.includes("external-nested.md"), "");

  console.log("\n页面错误日志: " + ((await page.evaluate(() => document.getElementById("out").textContent)).split("\n").filter((l) => l.includes("error")).join("; ") || "无"));
  console.log(failed === 0 ? "\n全部通过 ✔" : `\n${failed} 项失败 ✘`);
} finally {
  await browser.close();
}
