import { ADAPTERS } from "./exchanges";
import type { ExchangeCode, RiskStatus } from "./exchanges/types";
import type { DataResponse, TokenRow } from "@/app/api/data/route";

const RISK_RANK: Record<RiskStatus, number> = { ST: 1, DelistRisk: 2, Delisted: 3 };

const EXCHANGE_META: { code: ExchangeCode; name: string }[] = [
  { code: "gate", name: "Gate" },
  { code: "bingx", name: "BingX" },
  { code: "mexc", name: "MEXC" },
  { code: "bybit", name: "Bybit" },
  { code: "kucoin", name: "KuCoin" },
  { code: "lbank", name: "LBank" },
];

/**
 * 无数据库回退模式：直接并发调用所有 adapter 实时抓取，
 * 聚合成与 /api/data 相同格式的快照返回。
 * 用于本地演示 / 首次预览（不落库，无历史）。
 */
export async function collectLiveSnapshot(): Promise<DataResponse> {
  const startedAt = new Date();

  // 并发跑所有 adapter，单个失败不影响其他
  const entries = Object.values(ADAPTERS);
  const results = await Promise.allSettled(entries.map((a) => a.scan()));

  const map = new Map<string, TokenRow>();

  entries.forEach((adapter, i) => {
    const r = results[i];
    if (r.status !== "fulfilled") return; // 该交易所失败则跳过
    for (const f of r.value) {
      let row = map.get(f.symbol);
      if (!row) {
        row = {
          symbol: f.symbol,
          name: null,
          exchanges: {},
          count: 0,
          maxRisk: "ST",
          firstSeenAt: startedAt.toISOString(),
          lastSeenAt: startedAt.toISOString(),
        };
        map.set(f.symbol, row);
      }
      row.exchanges[adapter.code] = {
        status: f.status,
        source: f.source,
        pair: f.pair,
        note: f.note,
      };
      row.count += 1;
      if (RISK_RANK[f.status] > RISK_RANK[row.maxRisk]) row.maxRisk = f.status;
    }
  });

  const rows = [...map.values()].sort((a, b) => {
    if (RISK_RANK[b.maxRisk] !== RISK_RANK[a.maxRisk])
      return RISK_RANK[b.maxRisk] - RISK_RANK[a.maxRisk];
    if (b.count !== a.count) return b.count - a.count;
    return a.symbol.localeCompare(b.symbol);
  });

  const finishedAt = new Date();
  return {
    tokens: rows,
    exchanges: EXCHANGE_META,
    lastScan: { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString() },
  };
}
