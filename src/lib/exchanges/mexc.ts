import { fetchJson, baseSymbol, type ExchangeAdapter, type StFinding } from "./types";

/**
 * MEXC —— API 直接返回 ST 标志（与 KuCoin 类似，是最可靠的来源之一）。
 *
 * 数据源：GET https://api.mexc.com/api/v3/exchangeInfo
 * 每个 symbol 带有布尔字段 `st`：
 *   - true  → 处于 ST（Special Treatment）状态（仍在交易但被官方警告）
 *
 * ⚠️ 重要：之前曾把 `isSpotTradingAllowed: false`（交易暂停）也当作下架风险，
 *    但实测这类 ~110 个大多是流动性枯竭的旧项目，属于噪音且会淹没真正 ST。
 *    现已严格化：只认官方 `st: true` 标记（与 KuCoin/Bybit 对齐）。
 *    若某代币 st=true 且交易已暂停，仍会被 st 规则保留，不会丢失。
 */

interface MexcSymbol {
  symbol: string; // "BTCUSDT"
  status: string; // "1" = 正常
  isSpotTradingAllowed: boolean;
  st: boolean;
  quoteAsset?: string;
  baseAsset?: string;
}

interface MexcExchangeInfo {
  symbols: MexcSymbol[];
}

export const mexcAdapter: ExchangeAdapter = {
  code: "mexc",
  displayName: "MEXC",
  async scan(): Promise<StFinding[]> {
    const resp = await fetchJson<MexcExchangeInfo>(
      "https://api.mexc.com/api/v3/exchangeInfo"
    );
    const symbols = resp.symbols ?? [];

    const findings: StFinding[] = [];
    for (const s of symbols) {
      // 只认官方 ST 标记，排除交易暂停噪音
      if (s.st !== true) continue;

      // MEXC symbol 形如 "BTCUSDT"，转成 "BTC_USDT"
      const pair = normalizePair(s.symbol, s.baseAsset, s.quoteAsset);

      findings.push({
        symbol: baseSymbol(pair),
        pair,
        status: "ST",
        source: "api",
        note: "MEXC ST 标记",
        raw: { symbol: s.symbol, st: s.st, isSpotTradingAllowed: s.isSpotTradingAllowed, status: s.status },
      });
    }
    return findings;
  },
};

/** "BTCUSDT" -> "BTC_USDT"（已知 base/quote 时更稳，否则用常见后缀推断） */
function normalizePair(symbol: string, base?: string, quote?: string): string {
  if (base && quote) return `${base.toUpperCase()}_${quote.toUpperCase()}`;
  return baseSymbol(symbol) + "_USDT";
}
