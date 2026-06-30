/** 交易所代码 */
export type ExchangeCode =
  | "gate"
  | "bingx"
  | "mexc"
  | "bybit"
  | "kucoin"
  | "lbank";

export const ALL_EXCHANGES: ExchangeCode[] = [
  "gate",
  "bingx",
  "mexc",
  "bybit",
  "kucoin",
  "lbank",
];

/** 风险状态（由低到高） */
export type RiskStatus = "ST" | "DelistRisk" | "Delisted";

/** 数据来源 */
export type DataSource = "api" | "announcement";

/**
 * 单个交易所一次扫描产出的一条「风险代币」记录。
 * 注意：只包含「有风险」的代币，正常代币不产出。
 */
export interface StFinding {
  /** 基础币符号，统一大写，不含 _USDT，如 "ABC" */
  symbol: string;
  /** 交易对，如 "ABC_USDT" */
  pair: string;
  status: RiskStatus;
  source: DataSource;
  /** 备注，如公告标题或原因 */
  note?: string;
  /** 原始数据片段，便于排查（不要太大） */
  raw?: unknown;
}

/** adapter 抓取过程中针对单个交易所的结果 */
export interface AdapterResult {
  exchange: ExchangeCode;
  findings: StFinding[];
  /** 抓取是否出错（出错时保留旧数据，不覆盖） */
  error?: string;
  /** 耗时(ms) */
  durationMs: number;
}

/** 每个交易所实现此接口 */
export interface ExchangeAdapter {
  code: ExchangeCode;
  displayName: string;
  /** 执行一次扫描，返回所有「有风险」的代币列表 */
  scan(): Promise<StFinding[]>;
}

/** 简单的 HTTP GET JSON 帮助函数（带超时） */
export async function fetchJson<T>(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<T> {
  const { timeoutMs = 15_000, headers } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "STScan/0.1", ...headers },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 抓取 HTML 文本（公告页用） */
export async function fetchText(
  url: string,
  opts: { timeoutMs?: number } = {}
): Promise<string> {
  const { timeoutMs = 20_000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "text/html", "User-Agent": "STScan/0.1" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 从交易对 "abc-usdt" / "ABCUSDT" / "ABC_USDT" 提取大写基础币 "ABC" */
export function baseSymbol(pair: string): string {
  const normalized = pair.toUpperCase().replace(/[-_/]/, "_");
  const idx = normalized.search(/_(USDT|USDC|BTC|ETH|BUSD|FDUSD)$/);
  let base = idx >= 0 ? normalized.slice(0, idx) : normalized;
  base = base.replace(/USDT$|USDC$|BTC$|ETH$/, "");
  return base;
}
