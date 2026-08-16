// 测试用 clipboard mock：记录写入内容，供断言
let lastText: string | null = null;

export async function writeText(text: string): Promise<void> {
  lastText = text;
}
export async function readText(): Promise<string> {
  return lastText ?? "";
}
export function __lastText(): string | null {
  return lastText;
}
