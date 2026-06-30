import type { StatusChange } from "./scan";

const STATUS_LABEL: Record<string, string> = {
  ST: "ST 标记",
  DelistRisk: "下架风险",
  Delisted: "已下架",
  Removed: "已恢复正常",
};

const EXCHANGE_LABEL: Record<string, string> = {
  gate: "Gate",
  bingx: "BingX",
  mexc: "MEXC",
  bybit: "Bybit",
  kucoin: "KuCoin",
  lbank: "LBank",
};

/** 是否配置了 Telegram 推送 */
export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** 把变更列表格式化为中文消息 */
export function formatChangesMessage(changes: StatusChange[]): string {
  const added: string[] = [];
  const escalated: string[] = [];
  const recovered: string[] = [];

  for (const c of changes) {
    const line = `${EXCHANGE_LABEL[c.exchange] ?? c.exchange}｜${c.symbol}（${c.pair}）`;
    if (c.fromStatus === null) {
      added.push(`  • ${line} → ${STATUS_LABEL[c.toStatus] ?? c.toStatus}`);
    } else if (c.toStatus === "Removed") {
      recovered.push(`  • ${line}：${STATUS_LABEL[c.fromStatus] ?? c.fromStatus} → 已恢复正常/下线`);
    } else {
      escalated.push(
        `  • ${line}：${STATUS_LABEL[c.fromStatus] ?? c.fromStatus} → ${STATUS_LABEL[c.toStatus] ?? c.toStatus}`
      );
    }
  }

  const parts: string[] = [`🚨 STScan 风险变更（共 ${changes.length} 条）`];
  if (added.length) parts.push(`\n🆕 新增\n` + added.join("\n"));
  if (escalated.length) parts.push(`\n⚠️ 状态升级\n` + escalated.join("\n"));
  if (recovered.length) parts.push(`\n✅ 恢复正常\n` + recovered.join("\n"));
  return parts.join("\n");
}

/** 推送一条消息到 Telegram；未配置或失败时返回 false */
export async function notifyTelegram(message: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  // Telegram 单条消息上限 4096 字符
  const chunks = chunkMessage(message, 3800);
  try {
    for (const chunk of chunks) {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error("[notify] Telegram 发送失败:", res.status, txt);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.error("[notify] Telegram 异常:", e);
    return false;
  }
}

function chunkMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut <= 0) cut = maxLen;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}
