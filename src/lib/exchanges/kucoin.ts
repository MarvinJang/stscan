import { fetchJson, baseSymbol, type ExchangeAdapter, type StFinding } from "./types";

/**
 * KuCoin —— 6 家中唯一在 API 直接返回 ST 标志的交易所。
 *
 * 数据源：GET https://api.kucoin.com/api/v2/symbols
 * 响应里每条 symbol 带有布尔字段 `st`：
 *   - true  → 该交易对处于 ST（Special Treatment）状态
 *   - false → 正常
 *
 * KuCoin 的 ST 判定最可靠，直接采信该字段。
 */

interface KuCoinSymbol {
  symbol: string; // "BTC-USDT"
  name?: string;
  st: boolean;
  enableTrading?: boolean;
}

interface KuCoinSymbolsResp {
  code: string; // "200000" 表示成功
  data: KuCoinSymbol[];
}

export const kucoinAdapter: ExchangeAdapter = {
  code: "kucoin",
  displayName: "KuCoin",
  async scan(): Promise<StFinding[]> {
    const resp = await fetchJson<KuCoinSymbolsResp>(
      "https://api.kucoin.com/api/v2/symbols"
    );
    if (resp.code !== "200000" || !Array.isArray(resp.data)) {
      throw new Error(`KuCoin 返回异常: code=${resp.code}`);
    }

    const findings: StFinding[] = [];
    for (const s of resp.data) {
      if (!s.st) continue; // 只要 ST 的
      findings.push({
        symbol: baseSymbol(s.symbol),
        pair: s.symbol.toUpperCase().replace(/-/g, "_"), // BTC-USDT -> BTC_USDT
        status: "ST",
        source: "api",
        note: s.enableTrading === false ? "ST 且已暂停交易" : "KuCoin ST 标记",
        raw: { symbol: s.symbol, st: s.st, enableTrading: s.enableTrading },
      });
    }
    return findings;
  },
};
