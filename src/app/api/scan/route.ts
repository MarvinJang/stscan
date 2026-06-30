import { NextResponse } from "next/server";
import { runScan } from "@/lib/scan";
import { collectLiveSnapshot } from "@/lib/live";
import { formatChangesMessage, notifyTelegram, isTelegramConfigured } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * POST /api/scan?token=xxx
 * 触发一次全量扫描。建议由定时任务（cron）调用。
 * 如配置了 SCAN_TOKEN，则必须带 ?token= 一致才放行。
 *
 * 无数据库时（实时模式）：不落库、不做 diff 推送，
 * 仅返回实时快照，避免 cron 报错。
 */
export async function POST(req: Request) {
  // token 校验
  const expected = process.env.SCAN_TOKEN;
  if (expected) {
    const url = new URL(req.url);
    const got = url.searchParams.get("token");
    if (got !== expected) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // 无数据库 → 实时模式，跳过落库/推送
  if (!process.env.DATABASE_URL) {
    const live = await collectLiveSnapshot();
    return NextResponse.json({
      mode: "live",
      message: "实时模式（未配置 DATABASE_URL）：未落库、未推送。",
      snapshot: live,
    });
  }

  const summary = await runScan();

  // 有变更且配置了推送 → 发 Telegram
  let notified: boolean | undefined;
  if (summary.changes.length > 0 && isTelegramConfigured()) {
    const msg = formatChangesMessage(summary.changes);
    notified = await notifyTelegram(msg);
  }

  return NextResponse.json({
    ...summary,
    notified,
  });
}

/** GET 用于健康检查（不触发扫描） */
export async function GET() {
  return NextResponse.json({ ok: true });
}

