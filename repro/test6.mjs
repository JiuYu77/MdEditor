// repro/test6.mjs —— 欢迎页验证（VS Code 风格 Start + Recent）
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:5174/repro/test6.html";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__stats, { timeout: 20000 });

  console.log("=== 初始（有历史）===");
  console.log(JSON.stringify(await page.evaluate(() => window.__stats()), null, 1));

  // 点击动作按钮
  await page.evaluate(() => window.__clickAction(0));
  await page.evaluate(() => window.__clickAction(1));
  await page.evaluate(() => window.__clickAction(2));
  console.log("点击 新建/打开文件/打开文件夹 后:", await page.evaluate(() => JSON.parse(window.__stats().clicked)));

  // 点击历史条目
  await page.evaluate(() => window.__clickRecent(0)); // 第一个文件
  await page.evaluate(() => window.__clickRecent(4)); // 第一个文件夹
  console.log("点击历史后:", await page.evaluate(() => JSON.parse(window.__stats().clicked)));

  // × 删除历史
  console.log("\n=== × 删除历史 ===");
  console.log("× 按钮数量:", await page.evaluate(() => window.__removeCount()));
  await page.evaluate(() => window.__clickRemove(0)); // 删除第一个文件
  await new Promise((r) => setTimeout(r, 50));
  const s1 = await page.evaluate(() => window.__stats());
  console.log("删除后 recent:", s1.recent, "\nclicked:", s1.clicked);
  await page.evaluate(() => window.__clickRemove(3)); // 删除第一个文件夹（文件列表删了 1 条后，索引 3 = 第一个文件夹）
  await new Promise((r) => setTimeout(r, 50));
  const s2 = await page.evaluate(() => window.__stats());
  console.log("再删文件夹后 recent:", s2.recent, "\nclicked:", s2.clicked);

  // 无文件夹 → 新建按钮禁用
  await page.evaluate(() => window.__setNoFolder());
  await new Promise((r) => setTimeout(r, 50));
  console.log("\n=== 未打开文件夹（新建禁用）===");
  console.log(JSON.stringify((await page.evaluate(() => window.__stats())).actions));

  // 无历史 → 空态
  await page.evaluate(() => window.__setNoRecent());
  await new Promise((r) => setTimeout(r, 50));
  console.log("\n=== 无历史 ===");
  console.log(JSON.stringify(await page.evaluate(() => window.__stats()), null, 1));

  // 11 条历史（>6）→ 内部滚动
  await page.evaluate(() => window.__setManyRecent());
  await new Promise((r) => setTimeout(r, 50));
  console.log("\n=== 11 条历史（>6 应滚动）===");
  console.log("scroll:", JSON.stringify(await page.evaluate(() => window.__scrollMetrics())));
  console.log("recent 条数:", await page.evaluate(() => document.querySelectorAll(".welcome-recent-item").length));

  // 刚好 6 条 → 不滚动
  await page.evaluate(() => window.__setSixRecent());
  await new Promise((r) => setTimeout(r, 50));
  console.log("\n=== 6 条历史（不滚动）===");
  console.log("scroll:", JSON.stringify(await page.evaluate(() => window.__scrollMetrics())));

  // 滚动条 hover 显示（11 条场景）
  await page.evaluate(() => window.__setManyRecent());
  await new Promise((r) => setTimeout(r, 50));
  const before = await page.evaluate(() => document.querySelector(".welcome-recent-scroll")?.className ?? "no-scroll");
  const box = await page.evaluate(() => {
    const el = document.querySelector(".welcome-recent-scroll");
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await new Promise((r) => setTimeout(r, 100));
  const after = await page.evaluate(() => document.querySelector(".welcome-recent-scroll")?.className ?? "no-scroll");
  await page.mouse.move(10, 600); // 移出
  await new Promise((r) => setTimeout(r, 100));
  const left = await page.evaluate(() => document.querySelector(".welcome-recent-scroll")?.className ?? "no-scroll");
  console.log("\n=== 滚动条 hover ===\n悬停前:", before, "\n悬停中:", after, "\n移出后:", left);
} finally {
  await browser.close();
}
