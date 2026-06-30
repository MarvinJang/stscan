import { withTransaction, query } from "./db";
import { ADAPTERS } from "./exchanges";
import type { ExchangeCode, AdapterResult, RiskStatus } from "./exchanges/types";

/** 一条状态变更（用于推送） */
export interface StatusChange {
  exchange: ExchangeCode;
  symbol: string;
  pair: string;
  fromStatus: RiskStatus | "Removed" | null;
  toStatus: RiskStatus | "Removed";
}

/** 一次扫描的汇总结果 */
export interface ScanSummary {
  startedAt: string;
  finishedAt: string;
  perExchange: AdapterResult[];
  changes: StatusChange[];
  /** 推送是否成功（未配置则跳过） */
  notified?: boolean;
}

/**
 * 主扫描流程：
 * 1. 并发跑所有 adapter，拿到每个交易所「有风险」的代币清单
 * 2. 与 DB 当前快照做 diff
 * 3. 写入/更新 st_records，状态变化写 st_history
 * 4. 返回变更列表（由调用方决定是否推送）
 */
export async function runScan(): Promise<ScanSummary> {
  const startedAt = new Date();
  const perExchange: AdapterResult[] = [];

  // 并发执行所有 adapter；单个失败不影响其他
  const entries = Object.values(ADAPTERS);
  const results = await Promise.allSettled(
    entries.map(async (adapter) => {
      const t0 = Date.now();
      try {
        const findings = await adapter.scan();
        return {
          exchange: adapter.code,
          findings,
          durationMs: Date.now() - t0,
        } as AdapterResult;
      } catch (e) {
        return {
          exchange: adapter.code,
          findings: [],
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - t0,
        } as AdapterResult;
      }
    })
  );

  for (const r of results) {
    perExchange.push(
      r.status === "fulfilled"
        ? r.value
        : {
            exchange: "kucoin" as ExchangeCode,
            findings: [],
            error: r.reason?.message ?? String(r.reason),
            durationMs: 0,
          }
    );
  }

  const changes = await applyFindings(perExchange);

  const finishedAt = new Date();
  // 更新扫描时间戳
  await query(
    `INSERT INTO scan_meta (key, value, updated_at)
     VALUES ('last_scan', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [
      JSON.stringify({ startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString() }),
    ]
  );

  return { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), perExchange, changes };
}

/**
 * 把各 adapter 的 findings 落库，并产出状态变更。
 * 对于抓取出错的交易所，跳过（保留其旧数据）。
 */
async function applyFindings(perExchange: AdapterResult[]): Promise<StatusChange[]> {
  const changes: StatusChange[] = [];

  await withTransaction(async (client) => {
    for (const { exchange, findings, error } of perExchange) {
      // 出错的交易所不更新其记录（避免误把全部标为 Removed）
      if (error) continue;

      // 当前 DB 中该交易所的快照：token_id -> record
      const curRes = await client.query<{
        id: number;
        token_id: number;
        pair: string;
        status: RiskStatus;
      }>(
        `SELECT id, token_id, pair, status FROM st_records WHERE exchange = $1`,
        [exchange]
      );
      const currentMap = new Map<string, (typeof curRes.rows)[number]>();
      for (const row of curRes.rows) {
        currentMap.set(row.pair, row);
      }

      // 本次扫描命中的 pair 集合
      const seenPairs = new Set<string>();

      for (const f of findings) {
        seenPairs.add(f.pair);
        const tokenId = await upsertToken(client, f.symbol);

        const existing = currentMap.get(f.pair);
        if (!existing) {
          // 新增记录
          const ins = await client.query<{ id: number }>(
            `INSERT INTO st_records (token_id, exchange, pair, status, source, note, raw_payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [
              tokenId,
              exchange,
              f.pair,
              f.status,
              f.source,
              f.note ?? null,
              JSON.stringify(f.raw ?? null),
            ]
          );
          const recordId = ins.rows[0].id;
          await client.query(
            `INSERT INTO st_history (record_id, token_id, exchange, from_status, to_status)
             VALUES ($1, $2, $3, NULL, $4)`,
            [recordId, tokenId, exchange, f.status]
          );
          changes.push({
            exchange,
            symbol: f.symbol,
            pair: f.pair,
            fromStatus: null,
            toStatus: f.status,
          });
        } else if (existing.status !== f.status) {
          // 状态变化
          await client.query(
            `UPDATE st_records
             SET status=$1, source=$2, note=$3, raw_payload=$4, last_seen_at=now()
             WHERE id=$5`,
            [
              f.status,
              f.source,
              f.note ?? null,
              JSON.stringify(f.raw ?? null),
              existing.id,
            ]
          );
          await client.query(
            `INSERT INTO st_history (record_id, token_id, exchange, from_status, to_status)
             VALUES ($1, $2, $3, $4, $5)`,
            [existing.id, tokenId, exchange, existing.status, f.status]
          );
          changes.push({
            exchange,
            symbol: f.symbol,
            pair: f.pair,
            fromStatus: existing.status,
            toStatus: f.status,
          });
        } else {
          // 状态未变，仅刷新 last_seen_at
          await client.query(
            `UPDATE st_records SET last_seen_at=now(), note=$1 WHERE id=$2`,
            [f.note ?? null, existing.id]
          );
        }
      }

      // DB 里有但本次没命中的记录 → 视为已恢复正常/已下线，记为 Removed
      for (const [pair, row] of currentMap) {
        if (seenPairs.has(pair)) continue;
        await client.query(
          `INSERT INTO st_history (record_id, token_id, exchange, from_status, to_status)
           VALUES ($1, $2, $3, $4, 'Removed')`,
          [row.id, row.token_id, exchange, row.status]
        );
        await client.query(`DELETE FROM st_records WHERE id=$1`, [row.id]);
        changes.push({
          exchange,
          symbol: pair,
          pair,
          fromStatus: row.status,
          toStatus: "Removed",
        });
      }
    }
  });

  return changes;
}

/** 按符号 upsert token，返回 token_id */
async function upsertToken(
  client: import("pg").PoolClient,
  symbol: string
): Promise<number> {
  const r = await client.query<{ id: number }>(
    `INSERT INTO tokens (symbol) VALUES ($1)
     ON CONFLICT (symbol) DO UPDATE SET symbol = EXCLUDED.symbol
     RETURNING id`,
    [symbol]
  );
  return r.rows[0].id;
}
