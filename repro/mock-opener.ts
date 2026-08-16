// 测试用 opener mock：记录 reveal / openUrl 调用
const g = globalThis as { __revealed?: string[]; __openedUrls?: string[] };

export async function revealItemInDir(path: string): Promise<void> {
  (g.__revealed ??= []).push(path);
}
export async function openUrl(url: string): Promise<void> {
  (g.__openedUrls ??= []).push(url);
}
