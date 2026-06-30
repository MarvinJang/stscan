import { fetchJson, baseSymbol, type ExchangeAdapter, type StFinding } from "./types";

/**
 * Bybit —— API 直接返回 ST 标志。
 *
 * 数据源：GET https://api.bybit.com/v5/market/instruments-info?category=spot
 * 每个现货品种带有字段 `stTag`：
 *   - "1" → 处于 ST（Special Treatment）状态（仍在交易但被官方警告）
 *   - "0" → 正常
 *
 * 只认官方 stTag 标记，与 KuCoin/MEXC 对齐。
 */

interface BybitInstrument {
  symbol: string; // "BTCUSDT"
  baseCoin: string;
  quoteCoin: string;
  status: string; // Trading | ...
  stTag: string; // "0" | "1"
}

interface BybitInstrumentsResp {
  retCode: number; // 0 = OK
  retMsg: string;
  result: { list: BybitInstrument[] };
}

export const bybitAdapter: ExchangeAdapter = {
  code: "bybit",
  displayName: "Bybit",
  async scan(): Promise<StFinding[]> {
    const resp = await fetchJson<BybitInstrumentsResp>(
      "https://api.bybit.com/v5/market/instruments-info?category=spot"
    );
    if (resp.retCode !== 0 || !resp.result?.list) {
      throw new Error(`Bybit 返回异常: retCode=${resp.retCode} msg=${resp.retMsg}`);
    }

    const findings: StFinding[] = [];
    for (const inst of resp.result.list) {
      // 只认官方 ST 标记
      if (String(inst.stTag) !== "1") continue;

      const pair = inst.baseCoin && inst.quoteCoin
        ? `${inst.baseCoin.toUpperCase()}_${inst.quoteCoin.toUpperCase()}`
        : `${baseSymbol(inst.symbol)}_USDT`;

      findings.push({
        symbol: baseSymbol(pair),
        pair,
        status: "ST",
        source: "api",
        note: "Bybit ST 标记",
        raw: { symbol: inst.symbol, stTag: inst.stTag, status: inst.status },
      });
    }
    return findings;
  },
};
