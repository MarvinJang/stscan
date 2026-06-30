"use client";

import { useEffect, useMemo, useState } from "react";
import type { DataResponse, TokenRow } from "./api/data/route";

const STATUS_LABEL: Record<string, string> = {
  ST: "ST",
  DelistRisk: "下架风险",
  Delisted: "已下架",
};

const SOURCE_LABEL: Record<string, string> = { api: "API", announcement: "公告" };

const STATUS_STYLE: Record<string, string> = {
  ST: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
  DelistRisk: "bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30",
  Delisted: "bg-red-500/15 text-red-300 ring-1 ring-red-500/40",
};

/** 各交易所「ST/风险」判定口径（表头 tooltip 展示） */
const EXCHANGE_RULE: Record<string, { title: string; source: string }> = {
  gate: {
    title: "Gate",
    source: "现货 API：交易对仍存活但 trade_disabled（交易已禁用）= 下架流程中。",
  },
  bingx: {
    title: "BingX",
    source: "现货 API：offTime（下线时间）在未来或近 60 天内 = 正处于下架流程中。",
  },
  mexc: {
    title: "MEXC",
    source: "现货 API：官方 st 字段为 true（仍在交易但被官方标为 ST 警告）。",
  },
  bybit: {
    title: "Bybit",
    source: "现货 API：官方 stTag 字段为 1（被官方标为 ST 警告）。",
  },
  kucoin: {
    title: "KuCoin",
    source: "现货 API：官方 st 字段为 true（被官方标为 ST 警告）。",
  },
  lbank: {
    title: "LBank",
    source: "行情 API：24h 成交额 = 0（完全丧失流动性 = 实质死亡/下架流程）。",
  },
};

export default function Home() {
  const [data, setData] = useState<DataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterExchange, setFilterExchange] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DataResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/data", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as DataResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo<TokenRow[]>(() => {
    if (!data) return [];
    const list = data.tokens.filter((t) => {
      if (search && !t.symbol.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterExchange !== "all" && !t.exchanges[filterExchange]) return false;
      if (filterStatus !== "all") {
        const has = Object.values(t.exchanges).some((c) => c.status === filterStatus);
        if (!has) return false;
      }
      return true;
    });
    // 命中 ≥2 家交易所的置顶（跨所关联，最有价值）
    return list.sort((a, b) => {
      const aMulti = a.count >= 2 ? 1 : 0;
      const bMulti = b.count >= 2 ? 1 : 0;
      if (aMulti !== bMulti) return bMulti - aMulti; // 多所命中的排前
      return b.count - a.count; // 再按命中数
    });
  }, [data, search, filterExchange, filterStatus]);

  const stats = useMemo(() => {
    if (!data) return { total: 0, byStatus: { ST: 0, DelistRisk: 0, Delisted: 0 } };
    const byStatus = { ST: 0, DelistRisk: 0, Delisted: 0 };
    for (const t of data.tokens) {
      byStatus[t.maxRisk as "ST" | "DelistRisk" | "Delisted"] += 1;
    }
    return { total: data.tokens.length, byStatus };
  }, [data]);

  return (
    <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <header className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              STScan <span className="text-amber-400">⚡</span>
            </h1>
            <p className="text-neutral-400 mt-1 text-sm">
              跨交易所 ST（特殊处理）代币监控 · Gate / BingX / MEXC / Bybit / KuCoin / LBank
            </p>
          </div>
          <div className="text-right text-xs text-neutral-500">
            {data?.lastScan ? (
              <>
                最近扫描 {new Date(data.lastScan.finishedAt).toLocaleString("zh-CN")}
                <br />
              </>
            ) : null}
            <button
              onClick={load}
              className="mt-1 text-neutral-300 hover:text-white underline underline-offset-2"
            >
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <StatCard label="监控代币总数" value={stats.total} accent="text-white" />
          <StatCard label="ST 标记" value={stats.byStatus.ST} accent="text-amber-300" />
          <StatCard label="下架风险" value={stats.byStatus.DelistRisk} accent="text-orange-300" />
          <StatCard label="已下架" value={stats.byStatus.Delisted} accent="text-red-300" />
        </div>
      </header>

      {/* 筛选栏 */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索代币符号，如 ABC"
          className="px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-sm focus:outline-none focus:border-neutral-600 w-56"
        />
        <select
          value={filterExchange}
          onChange={(e) => setFilterExchange(e.target.value)}
          className="px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-sm focus:outline-none focus:border-neutral-600"
        >
          <option value="all">全部交易所</option>
          {data?.exchanges.map((ex) => (
            <option key={ex.code} value={ex.code}>
              {ex.name}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-sm focus:outline-none focus:border-neutral-600"
        >
          <option value="all">全部状态</option>
          <option value="ST">ST</option>
          <option value="DelistRisk">下架风险</option>
          <option value="Delisted">已下架</option>
        </select>
        <span className="text-xs text-neutral-500 self-center ml-auto">
          共 {filtered.length} 个代币
        </span>
      </div>

      {/* 表格 */}
      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-300">
          加载失败：{error}
          <br />
          <span className="text-neutral-500">
            请确认数据库已初始化且 <code>DATABASE_URL</code> 配置正确（见 .env.example）。
          </span>
        </div>
      ) : loading && !data ? (
        <div className="text-neutral-500 text-sm py-12 text-center">加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="text-neutral-500 text-sm py-12 text-center">
          {data && data.tokens.length === 0
            ? "暂无数据。点击右上角运行首次扫描，或调用 POST /api/scan。"
            : "没有符合条件的代币。"}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-900 text-neutral-400 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">代币</th>
                {data!.exchanges.map((ex) => {
                  const rule = EXCHANGE_RULE[ex.code];
                  return (
                    <th key={ex.code} className="text-center px-3 py-3 font-medium">
                      <span className="group relative inline-flex items-center gap-1 cursor-help">
                        {ex.name}
                        <span className="text-neutral-600 group-hover:text-neutral-300">ⓘ</span>
                        {rule && (
                          <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden -translate-x-1/2 w-52 rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-left normal-case tracking-normal text-xs text-neutral-300 shadow-xl group-hover:block">
                            <span className="block font-semibold text-neutral-100">
                              {rule.title} 判定口径
                            </span>
                            <span className="mt-1 block leading-relaxed text-neutral-400">
                              {rule.source}
                            </span>
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
                <th className="text-left px-4 py-3 font-medium">首次发现</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const isMulti = t.count >= 2;
                return (
                <tr
                  key={t.symbol}
                  className={
                    isMulti
                      ? "border-t border-amber-500/30 bg-amber-500/[0.07] hover:bg-amber-500/10"
                      : "border-t border-neutral-800 hover:bg-neutral-900/60"
                  }
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{t.symbol}</span>
                      {isMulti && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-400 text-neutral-900">
                          {t.count}所
                        </span>
                      )}
                    </div>
                    {t.name && <div className="text-xs text-neutral-500">{t.name}</div>}
                  </td>
                  {data!.exchanges.map((ex) => {
                    const cell = t.exchanges[ex.code];
                    return (
                      <td key={ex.code} className="px-3 py-3 text-center">
                        {cell ? (
                          <div className="inline-flex flex-col items-center gap-1">
                            <span
                              className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_STYLE[cell.status]}`}
                            >
                              {STATUS_LABEL[cell.status]}
                            </span>
                            <span className="text-[10px] text-neutral-500">
                              {SOURCE_LABEL[cell.source]}
                            </span>
                          </div>
                        ) : (
                          <span className="text-neutral-700">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-xs text-neutral-500">
                    {new Date(t.firstSeenAt).toLocaleDateString("zh-CN")}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <footer className="mt-8 text-xs text-neutral-600 leading-relaxed">
        <p>
          <span className="text-neutral-400">说明：</span>各交易所「ST」判定依据不同。KuCoin
          为 API 直接标记；Gate/MEXC/Bybit 为基于下架风险信号的近似推断；BingX/LBank 为公告抓取。
          单元格下方标注数据来源（API / 公告）。本工具仅供信息参考，不构成投资建议。
        </p>
      </footer>
    </main>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent}`}>{value}</div>
    </div>
  );
}
