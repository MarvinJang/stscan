import { fetchJson, baseSymbol, type ExchangeAdapter, type StFinding } from "./types";

/**
 * Gate.io —— 基于 API 信号推断 ST/下架风险。
 *
 * Gate 的 /spot/currencies 没有「ST」字段，但暴露了下架/禁用信号：
 *   - delisted: true        已标记下架（但这些币种一般已无活跃交易对）
 *   - trade_disabled: true  交易被禁用但交易对仍存活 → 典型的「ST/下架流程中」
 *
 * 策略：把 /spot/currencies 与 /spot/tickers 做交集，
 *       只保留「仍有活跃交易对 + trade_disabled」的币种，标注为下架风险。
 *       （避免把几千个早已下架的历史币种当作监控对象）
 *
 * 注意：Gate 的 ST 是「近似定义」，前端会显示 source=API 供用户判断。
 */

interface GateCurrency {
  currency: string;
  name?: string;
  delisted: boolean;
  withdraw_disabled: boolean;
  deposit_disabled: boolean;
  trade_disabled: boolean;
}

interface GateTicker {
  currency_pair: string; // "BTC_USDT"
}

export const gateAdapter: ExchangeAdapter = {
  code: "gate",
  displayName: "Gate",
  async scan(): Promise<StFinding[]> {
    const [currencies, tickers] = await Promise.all([
      fetchJson<GateCurrency[]>("https://api.gateio.ws/api/v4/spot/currencies"),
      fetchJson<GateTicker[]>("https://api.gateio.ws/api/v4/spot/tickers"),
    ]);

    // 建立仍存活交易对的索引：baseCurrency -> pair 列表
    const livePairs = new Map<string, string[]>();
    for (const t of tickers) {
      const base = t.currency_pair.split("_")[0];
      if (!livePairs.has(base)) livePairs.set(base, []);
      livePairs.get(base)!.push(t.currency_pair);
    }

    const findings: StFinding[] = [];
    for (const c of currencies) {
      // 只看仍有活跃交易对的币种；无活跃交易对的视为已彻底下架，不纳入监控
      const pairs = livePairs.get(c.currency);
      if (!pairs) continue;

      // 杠杆/ETF 代币（如 BNB3L、HYPE3S）天然禁充提，不是 ST 信号，跳过
      if (/\d+[LS]$/.test(c.currency)) continue;

      // ⚠️ 严格化：只认 trade_disabled（交易对仍存活但交易被禁用 = 下架流程中）。
      //   之前曾把「充提双禁用」也当信号，但那类多为死项目噪音，已去除。
      if (c.trade_disabled !== true) continue;

      const status = "DelistRisk";
      const note = "Gate 交易已禁用（下架流程中）";

      // 取首个 USDT 对（若没有则取第一个）
      const preferred =
        pairs.find((p) => p.endsWith("_USDT")) ?? pairs[0];
      findings.push({
        symbol: baseSymbol(preferred),
        pair: preferred,
        status,
        source: "api",
        note,
        raw: {
          currency: c.currency,
          delisted: c.delisted,
          trade_disabled: c.trade_disabled,
          withdraw_disabled: c.withdraw_disabled,
          deposit_disabled: c.deposit_disabled,
        },
      });
    }
    return findings;
  },
};
