/**
 * 命令行扫描入口：npm run scan
 * 等同于调用 POST /api/scan，但可在本地/CI 直接跑。
 */
import { runScan } from "../src/lib/scan";

async function main() {
  console.log("▶ 开始扫描…");
  const summary = await runScan();

  console.log(`\n✓ 扫描完成，耗时 ${summary.perExchange.reduce((a, b) => a + b.durationMs, 0)}ms\n`);
  for (const ex of summary.perExchange) {
    const errTag = ex.error ? ` ❌ ${ex.error}` : "";
    console.log(
      `  ${ex.exchange.padEnd(8)} 命中 ${String(ex.findings.length).padStart(3)} 个${errTag}`
    );
  }

  if (summary.changes.length > 0) {
    console.log(`\n🔔 状态变更 ${summary.changes.length} 条：`);
    for (const c of summary.changes) {
      const from = c.fromStatus ?? "无";
      console.log(`  ${c.exchange}｜${c.symbol}（${c.pair}）: ${from} → ${c.toStatus}`);
    }
  } else {
    console.log("\n（无状态变更）");
  }
  console.log(`\nnotified=${summary.notified ?? "未配置推送"}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("扫描失败:", e);
  process.exit(1);
});
