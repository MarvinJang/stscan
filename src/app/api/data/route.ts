import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { collectLiveSnapshot } from "@/lib/live";
import { ALL_EXCHANGES, type ExchangeCode, type RiskStatus } from "@/lib/exchanges/types";

export const dynamic = "force-dynamic";

export interface Cell {
  status: RiskStatus;
  source: "api" | "announcement";
  pair: string;
  note?: string | null;
}

export interface TokenRow {
  symbol: string;
  name: string | null;
  /** exchange -> cell（仅包含有风险的交易所） */
  exchanges: Record<string, Cell>;
  /** 命中的交易所数 */
  count: number;
  /** 最高风险级别（用于排序） */
  maxRisk: RiskStatus;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface DataResponse {
  tokens: TokenRow[];
  exchanges: { code: ExchangeCode; name: string }[];
  lastScan: { startedAt: string; finishedAt: string } | null;
}

const RISK_RANK: Record<RiskStatus, number> = { ST: 1, DelistRisk: 2, Delisted: 3 };

/** GET /api/data —— 返回当前快照（代币 × 交易所矩阵）
 *  无数据库时自动回退到「实时抓取模式」（不落库，直接调各 adapter）。*/
export async function GET() {
  // 未配置数据库 → 直接走实时回退，避免连接报错
  if (!process.env.DATABASE_URL) {
    const live = await collectLiveSnapshot();
    return NextResponse.json<DataResponse>(live);
  }

  try {
    return NextResponse.json<DataResponse>(await fromDatabase());
  } catch (e) {
    // 数据库不可用（未初始化、连不上等）→ 回退实时抓取，保证看板可用
    console.warn("[/api/data] 数据库查询失败，回退实时抓取:", e instanceof Error ? e.message : e);
    const live = await collectLiveSnapshot();
    return NextResponse.json<DataResponse>(live);
  }
}

/** 从数据库读取当前快照 */
async function fromDatabase(): Promise<DataResponse> {
  const tokens = await query<{
    symbol: string;
    name: string | null;
    exchange: ExchangeCode;
    pair: string;
    status: RiskStatus;
    source: "api" | "announcement";
    note: string | null;
    first_seen_at: string;
    last_seen_at: string;
  }>(
    `SELECT t.symbol, t.name, r.exchange, r.pair, r.status, r.source, r.note,
            r.first_seen_at, r.last_seen_at
     FROM st_records r
     JOIN tokens t ON t.id = r.token_id
     ORDER BY t.symbol`
  );

  // 聚合为「按代币」一行
  const map = new Map<string, TokenRow>();
  for (const r of tokens.rows) {
    let row = map.get(r.symbol);
    if (!row) {
      row = {
        symbol: r.symbol,
        name: r.name,
        exchanges: {},
        count: 0,
        maxRisk: "ST",
        firstSeenAt: r.first_seen_at,
        lastSeenAt: r.last_seen_at,
      };
      map.set(r.symbol, row);
    }
    row.exchanges[r.exchange] = {
      status: r.status,
      source: r.source,
      pair: r.pair,
      note: r.note,
    };
    row.count += 1;
    if (RISK_RANK[r.status] > RISK_RANK[row.maxRisk]) row.maxRisk = r.status;
    if (new Date(r.first_seen_at) < new Date(row.firstSeenAt)) {
      row.firstSeenAt = r.first_seen_at;
    }
    if (new Date(r.last_seen_at) > new Date(row.lastSeenAt)) {
      row.lastSeenAt = r.last_seen_at;
    }
  }

  // 排序：先按风险级别降序，再按命中交易所数降序，最后按符号
  const rows = [...map.values()].sort((a, b) => {
    if (RISK_RANK[b.maxRisk] !== RISK_RANK[a.maxRisk])
      return RISK_RANK[b.maxRisk] - RISK_RANK[a.maxRisk];
    if (b.count !== a.count) return b.count - a.count;
    return a.symbol.localeCompare(b.symbol);
  });

  // 最近扫描时间
  let lastScan: DataResponse["lastScan"] = null;
  try {
    const meta = await query<{ value: string }>(
      `SELECT value FROM scan_meta WHERE key = 'last_scan'`
    );
    if (meta.rows[0]) {
      lastScan = JSON.parse(meta.rows[0].value);
    }
  } catch {
    // scan_meta 可能尚未初始化（表不存在），忽略
  }

  const exchanges = ALL_EXCHANGES.map((code) => ({
    code,
    name: ({ gate: "Gate", bingx: "BingX", mexc: "MEXC", bybit: "Bybit", kucoin: "KuCoin", lbank: "LBank" } as const)[code],
  }));

  return {
    tokens: rows,
    exchanges,
    lastScan,
  };
}
