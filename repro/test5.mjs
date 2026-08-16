// repro/test5.mjs —— 文件树：选中目录后头部按钮在选中目录下新建
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.REPRO_URL || "http://localhost:5174/repro/test5.html";

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
  await page.waitForFunction(() => window.__tree, { timeout: 20000 });

  const tree = () => page.evaluate(() => window.__tree().map((n) => `${n.icon}${n.text}${n.selected ? "*" : ""}`).join("\n"));
  const title = () => page.evaluate(() => window.__title());

  console.log("=== 初始 ===\n标题: " + (await title()) + "\n" + (await tree()));

  // 0. 文件类型图标映射
  const icons = await page.evaluate(() => JSON.stringify(window.__iconMap()));
  console.log("\n=== 图标映射 ===\n" + icons);
  const expectIcons = {
    docs: "fa-solid fa-folder",
    "app.js": "fa-brands fa-js",
    "config.yml": "fa-solid fa-gear",
    "other.md": "fa-brands fa-markdown",
    "photo.png": "fa-solid fa-file-image",
  };
  for (const [name, cls] of Object.entries(expectIcons)) {
    const actual = JSON.parse(icons)[name];
    console.log(`${name}: ${actual} ${actual === cls ? "OK" : "BAD(期望 " + cls + ")"}`);
  }

  // 0. 右键菜单结构
  await page.evaluate(() => window.__rightClick(0)); // docs（目录）
  await new Promise((r) => setTimeout(r, 50));
  console.log("目录右键:", await page.evaluate(() => `[${window.__menuItems().join("|")}]`));
  await page.evaluate(() => window.__clickBlank());
  await page.evaluate(() => window.__rightClick(1)); // other.md（文件）
  await new Promise((r) => setTimeout(r, 50));
  console.log("文件右键:", await page.evaluate(() => `[${window.__menuItems().join("|")}]`));
  // 点击"在文件管理器中显示" → 应记录路径
  await page.evaluate(() => window.__clickMenuItem(0));
  await new Promise((r) => setTimeout(r, 50));
  console.log("reveal 调用:", await page.evaluate(() => JSON.stringify(globalThis.__revealed ?? [])));
  await page.evaluate(() => window.__clickBlank());

  // 1. 点击 docs 目录 → 展开 + 设为新建目标
  await page.evaluate(() => window.__clickNode(0));
  await new Promise((r) => setTimeout(r, 80));
  console.log("\n=== 点击 docs 后 ===\n标题: " + (await title()) + "\n" + (await tree()));

  // 2. 点头部“新建文件”图标 → 输入框应出现在 docs 内（目标目录）
  await page.evaluate(() => window.__clickHeaderBtn(0));
  await new Promise((r) => setTimeout(r, 50));
  console.log("\n=== 头部新建文件后 ===\n" + (await tree()));

  // 3. 输入名称回车 → 文件应创建在 docs 下
  await page.evaluate(() => window.__setInput(0, "in-docs.md"));
  await page.evaluate(() => window.__pressEnter(0));
  await new Promise((r) => setTimeout(r, 80));
  console.log("\n=== 创建 in-docs.md 后 ===\n" + (await tree()));

  // 4. 头部新建文件夹 → 也应在 docs 下
  await page.evaluate(() => window.__clickHeaderBtn(1));
  await new Promise((r) => setTimeout(r, 50));
  await page.evaluate(() => window.__setInput(0, "sub-folder"));
  await page.evaluate(() => window.__pressEnter(0));
  await new Promise((r) => setTimeout(r, 80));
  console.log("\n=== 头部新建文件夹 sub-folder 后 ===\n" + (await tree()));

  // 5. 点击文件 readme.md（在 docs 内）→ 目标切到 docs；然后头部新建 → 落在 docs
  //    （当前 docs 已展开：节点顺序 docs/notes/sub-folder/in-docs.md/readme.md）
  const fileIdx = await page.evaluate(() => {
    const arr = window.__tree();
    return arr.findIndex((n) => n.text === "readme.md");
  });
  await page.evaluate((i) => window.__clickNode(i), fileIdx);
  await new Promise((r) => setTimeout(r, 50));
  console.log("\n=== 点击 readme.md 后（目标应切到 docs）===\n标题: " + (await title()));

  // 6. 点击树空白 → 目标重置为根目录
  await page.evaluate(() => window.__clickBlank());
  await new Promise((r) => setTimeout(r, 50));
  console.log("\n=== 点击空白后（目标应重置）===\n标题: " + (await title()));

  // 7. 空白后头部新建文件 → 应落在根目录
  await page.evaluate(() => window.__clickHeaderBtn(0));
  await new Promise((r) => setTimeout(r, 50));
  await page.evaluate(() => window.__setInput(0, "root-file.md"));
  await page.evaluate(() => window.__pressEnter(0));
  await new Promise((r) => setTimeout(r, 80));
  console.log("\n=== 空白后头部新建 root-file.md ===\n" + (await tree()));

  // 8. 快照（期望 root-file.md 在根目录；in-docs.md/sub-folder 仍在 docs 下）
  console.log("\n=== 内存 fs 快照 ===\n" + (await page.evaluate(() => window.__snapshot())));
} finally {
  await browser.close();
}
