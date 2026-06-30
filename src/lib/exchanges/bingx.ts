import { fetchJson, baseSymbol, type ExchangeAdapter, type StFinding } from "./types";

/**
 * BingX —— 用「offTime（下线时间）」作为下架风险的替代信号。
 *
 * 背景：BingX 没有 ST 标签字段，公告页只能抓到「已下架」（用户不想看）。
 *   其现货 API /openApi/spot/v1/common/symbols 返回每个交易对的 offTime：
 *   0 = 仍活跃；非 0 = 该时间点下线。offTime 在「未来或近 30 天」即代表
 *   正处于下架流程中（DelistRisk），是最贴近 ST 语义的客观信号。
 *
 * 数据源：GET https://open-api.bingx.com/openApi/spot/v1/common/symbols
 *
 * 判定：
 *   - 排除 status=25（已彻底下架，用户不想看）
 *   - 排除测试币（TEST*）
 *   - 仅保留 offTime > now - 60 天（未来或近 60 天 = 活跃下架流程）→ DelistRisk
 *   （30 天太窄、跨所重合只有 1 个；60 天能捕捉到更多跨所关联，如 L3/POP/SCA/IMU）
 *
 * 这样和 Bybit/KuCoin 的 ST 形成跨所呼应（如 ARTY/ARCA/GINI/ZND）。
 */

interface BingXSymbol {
  symbol: string; // "BTC-USDT"
  status: number; // 0/1 正常, 25 已下架
  apiStateSell: boolean;
  apiStateBuy: boolean;
  offTime: number; // ms 时间戳，0 = 活跃
}

interface BingXSymbolsResp {
  code: number;
  data: { symbols: BingXSymbol[] };
}

export const bingxAdapter: ExchangeAdapter = {
  code: "bingx",
  displayName: "BingX",
  async scan(): Promise<StFinding[]> {
    const resp = await fetchJson<BingXSymbolsResp>(
      "https://open-api.bingx.com/openApi/spot/v1/common/symbols"
    );
    if (resp.code !== 0 || !resp.data?.symbols) {
      throw new Error(`BingX 返回异常: code=${resp.code}`);
    }

    const now = Date.now();
    const findings: StFinding[] = [];
    for (const s of resp.data.symbols) {
      // 排除已彻底下架（status=25）和测试币
      if (s.status === 25) continue;
      if (/^TEST/i.test(s.symbol)) continue;

      // offTime 在未来或近 60 天 = 活跃下架流程
      if (!s.offTime || s.offTime === 0) continue;
      if (s.offTime <= now - 60 * 86_400_000) continue;

      const pair = s.symbol.replace("-", "_").toUpperCase(); // BTC-USDT -> BTC_USDT
      findings.push({
        symbol: baseSymbol(pair),
        pair,
        status: "DelistRisk",
        source: "api",
        note: `BingX 下线时间 ${new Date(s.offTime).toISOString().slice(0, 10)}（下架流程中）`,
        raw: {
          symbol: s.symbol,
          status: s.status,
          offTime: s.offTime,
          apiStateSell: s.apiStateSell,
          apiStateBuy: s.apiStateBuy,
        },
      });
    }
    return findings;
  },
};
