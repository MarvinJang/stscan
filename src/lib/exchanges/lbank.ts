import { fetchJson, baseSymbol, type ExchangeAdapter, type StFinding } from "./types";

/**
 * LBank —— 用「零成交额」作为 ST/下架风险的替代信号。
 *
 * 背景：LBank 没有 ST 标签字段，公告页只能抓到「已下架」（且结构易变）。
 *   一个客观、可量化的替代信号是流动性：24h 成交额 = 0 的交易对，
 *   意味着已完全丧失流动性（项目实质死亡/进入下架流程）。
 *
 * 数据源：GET https://api.lbkex.com/v2/ticker/24hr.do?symbol=all
 *   返回 data[].symbol（如 "btc_usdt"）与 data[].ticker.turnover（24h 成交额，USDT 计）。
 *
 * 判定：turnover === 0 → Delisted（已无流动性）
 */

interface LBankTickerItem {
  symbol: string; // "btc_usdt"
  ticker: { turnover?: string; vol?: string };
}

interface LBankTickerResp {
  result: string;
  data: LBankTickerItem[];
}

export const lbankAdapter: ExchangeAdapter = {
  code: "lbank",
  displayName: "LBank",
  async scan(): Promise<StFinding[]> {
    const resp = await fetchJson<LBankTickerResp>(
      "https://api.lbkex.com/v2/ticker/24hr.do?symbol=all"
    );
    const items = resp.data ?? [];

    const findings: StFinding[] = [];
    for (const item of items) {
      const turnover = parseFloat(item.ticker?.turnover ?? "0");
      if (turnover > 0) continue; // 只取零成交额

      const pair = item.symbol.toUpperCase(); // btc_usdt -> BTC_USDT
      findings.push({
        symbol: baseSymbol(pair),
        pair,
        status: "Delisted",
        source: "api",
        note: "LBank 24h 成交额为 0（无流动性）",
        raw: { symbol: item.symbol, turnover: item.ticker?.turnover, vol: item.ticker?.vol },
      });
    }
    return findings;
  },
};
