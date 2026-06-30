# STScan ⚡ 跨交易所 ST 代币监控

监控 **Gate / BingX / MEXC / Bybit / KuCoin / LBank** 6 家交易所中被标注为
**ST（特殊处理）/ 下架风险** 的代币，在一个中文看板里展示
**「每个代币在哪些交易所处于 ST 状态」**，并支持新增 ST 时的 Telegram 推送。

## 技术栈

- **Next.js 16（App Router）+ TypeScript** —— 前后端一体
- **PostgreSQL** —— 存历史快照，可追踪状态变化
- **Vercel Cron** —— 定时触发扫描
- **Telegram Bot** —— 状态变更推送

## 各交易所 ST 判定方式

| 交易所 | 数据源 | 判定方式 | 来源标记 |
|--------|--------|----------|----------|
| **KuCoin** | API `/api/v2/symbols` | `st: true` 字段（官方 ST 标记） | API |
| **MEXC** | API `/api/v3/exchangeInfo` | `st: true` 字段；或 `isSpotTradingAllowed: false` | API |
| **Bybit** | API `/v5/market/instruments-info?category=spot` | `stTag: "1"`；或 `status` 非 Trading | API |
| **Gate** | API `/spot/currencies` + `/spot/tickers` | 交易对仍存活且 `trade_disabled`/充提双禁用（已剔除杠杆代币） | API |
| **BingX** | 公告页 HTML 抓取 | 解析 "Delist ... From Spot Trading" 公告 | 公告 |
| **LBank** | 公告页 HTML 抓取 | 解析 "delist the following trading pairs: XXX_USDT, ..." | 公告 |

> 说明：只有 KuCoin/MEXC/Bybit 有官方「ST」字段；Gate 为基于下架风险信号的近似；
> BingX/LBank 为公告抓取。表格单元格下方标注数据来源（API / 公告），便于判断依据。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```env
DATABASE_URL="postgresql://user:password@localhost:5432/stscan"
SCAN_TOKEN=""                 # 可选：保护 /api/scan 免被外部触发
TELEGRAM_BOT_TOKEN=""         # 可选：留空则跳过推送
TELEGRAM_CHAT_ID=""
```

### 3. 初始化数据库

创建一个名为 `stscan` 的 Postgres 数据库，然后执行 migration：

```bash
psql "$DATABASE_URL" -f db/migrations/0001_init.sql
```

### 4. 本地开发

```bash
npm run dev
```

打开 http://localhost:3000 看看板。

### 5. 手动触发一次扫描

- 命令行（不走 HTTP，直接跑全量扫描并落库）：

  ```bash
  npm run scan
  ```

- 或调用 API（带 token）：

  ```bash
  curl -X POST "http://localhost:3000/api/scan?token=你的SCAN_TOKEN"
  ```

## 定时任务

`vercel.json` 配置了每天触发一次 `/api/scan`（UTC 16:00 / 北京时间次日 00:00）：

```json
{ "crons": [{ "path": "/api/scan", "schedule": "0 16 * * *" }] }
```

> ⚠️ **Vercel 免费版（Hobby）限制 cron 每天最多 1 次**，所以这里用每日一次。
> 如需更高频率，可升级 Pro，或本地用 `node-cron` / 系统 cron 定时执行 `npm run scan`。
> 实时模式下看板走 `/api/data` 每次实时抓取，不依赖 cron，所以 cron 只用于落库历史 / 推送。

## 数据模型

- `tokens` —— 代币维度（symbol, name）
- `exchanges` —— 交易所维度（6 家，migration 中已预置）
- `st_records` —— 当前快照：每个「代币 × 交易所」的风险状态（status/source/note）
- `st_history` —— 状态变更日志（用于触发推送）
- `scan_meta` —— 最近扫描时间戳

## 推送示例

状态变更时，Telegram 收到的消息格式：

```
🚨 STScan 风险变更（共 3 条）

🆕 新增
  • MEXC｜ABC（ABC_USDT）→ ST 标记
  • Bybit｜XYZ（XYZ_USDT）→ ST 标记

✅ 恢复正常
  • KuCoin｜OLD（OLD_USDT）：ST 标记 → 已恢复正常/下线
```

## 目录结构

```
src/
├── app/
│   ├── page.tsx              # 中文看板（代币 × 交易所矩阵表格）
│   └── api/
│       ├── scan/route.ts     # POST 触发扫描（cron 调用）
│       └── data/route.ts     # GET 当前快照（前端取数）
├── lib/
│   ├── db.ts                 # Postgres 连接池
│   ├── scan.ts               # 统一扫描 + diff + 落库
│   ├── notify.ts             # Telegram 推送
│   └── exchanges/            # 6 家 adapter
│       ├── types.ts          # Adapter 接口 + 工具函数
│       ├── kucoin.ts gate.ts mexc.ts bybit.ts   # API 类
│       ├── bingx.ts lbank.ts                     # 公告抓取类
│       └── index.ts          # adapter 注册表
db/migrations/0001_init.sql
scripts/scan.ts               # 命令行扫描入口
vercel.json                   # cron 配置
```

## 风险与限制

- **公告抓取脆弱**：BingX / LBank 公告页 HTML 结构若变动会导致解析失败；
  adapter 抛错时会被 scan() 捕获、记录 `error`，**不影响其他交易所**，旧数据保留。
- **ST 近似定义**：除 KuCoin/MEXC/Bybit 外，「ST」是基于下架风险信号的近似，
  表格已标注 `source` 供用户判断。
- 本工具仅供信息参考，不构成投资建议。
