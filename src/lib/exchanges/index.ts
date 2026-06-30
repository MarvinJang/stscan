import type { ExchangeAdapter, ExchangeCode } from "./types";
import { kucoinAdapter } from "./kucoin";
// 其余 5 家 adapter 在后续步骤补齐，这里先留占位
import { gateAdapter } from "./gate";
import { mexcAdapter } from "./mexc";
import { bybitAdapter } from "./bybit";
import { bingxAdapter } from "./bingx";
import { lbankAdapter } from "./lbank";

export { kucoinAdapter, gateAdapter, mexcAdapter, bybitAdapter, bingxAdapter, lbankAdapter };
export * from "./types";

/** 所有 adapter 的注册表 */
export const ADAPTERS: Record<ExchangeCode, ExchangeAdapter> = {
  gate: gateAdapter,
  bingx: bingxAdapter,
  mexc: mexcAdapter,
  bybit: bybitAdapter,
  kucoin: kucoinAdapter,
  lbank: lbankAdapter,
};
