// 测试用 dialog mock：记录 ask 调用，返回值可配置
let askResult = true;
const askCalls: string[] = [];

export async function ask(message: string): Promise<boolean> {
  askCalls.push(message);
  return askResult;
}
export async function open(): Promise<string | null> {
  return null;
}
export async function save(): Promise<string | null> {
  return null;
}
/** 未保存保护弹窗：返回空串（不等于任何按钮文案 → 视为取消），测试默认不触发 */
export async function message(message: string): Promise<string> {
  return "";
}

export function __askCalls(): string[] {
  return [...askCalls];
}
export function __setAskResult(v: boolean): void {
  askResult = v;
}
export function __resetAsk(): void {
  askCalls.length = 0;
  askResult = true;
}
