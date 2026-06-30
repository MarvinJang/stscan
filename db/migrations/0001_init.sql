-- STScan 初始化 schema
-- 6 家交易所 ST 代币监控

BEGIN;

-- 交易所维度
CREATE TABLE IF NOT EXISTS exchanges (
  code       TEXT PRIMARY KEY,              -- gate / bingx / mexc / bybit / kucoin / lbank
  name       TEXT NOT NULL,                 -- 显示名：Gate / BingX / ...
  website    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO exchanges (code, name, website) VALUES
  ('gate',  'Gate',   'https://www.gate.com'),
  ('bingx', 'BingX',  'https://www.bingx.com'),
  ('mexc',  'MEXC',   'https://www.mexc.com'),
  ('bybit', 'Bybit',  'https://www.bybit.com'),
  ('kucoin','KuCoin', 'https://www.kucoin.com'),
  ('lbank', 'LBank',  'https://www.lbank.com')
ON CONFLICT (code) DO NOTHING;

-- 代币维度
CREATE TABLE IF NOT EXISTS tokens (
  id         BIGSERIAL PRIMARY KEY,
  symbol     TEXT NOT NULL,                 -- 基础币符号，如 ABC（不含 _USDT）
  name       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol)
);

-- 核心记录：每个「代币 × 交易所」的 ST 状态（当前快照）
CREATE TABLE IF NOT EXISTS st_records (
  id            BIGSERIAL PRIMARY KEY,
  token_id      BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  exchange      TEXT NOT NULL REFERENCES exchanges(code) ON DELETE CASCADE,
  pair          TEXT NOT NULL,              -- 交易对，如 ABC_USDT
  status        TEXT NOT NULL,              -- ST | DelistRisk | Delisted
  source        TEXT NOT NULL,              -- api | announcement
  note          TEXT,                       -- 备注（如公告标题 / 原因）
  raw_payload   JSONB,                      -- 原始 API/公告片段，便于排查
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- 首次被标记的时间
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),  -- 最近一次扫描确认的时间
  UNIQUE (token_id, exchange, pair)
);

CREATE INDEX IF NOT EXISTS idx_st_records_status ON st_records (status);
CREATE INDEX IF NOT EXISTS idx_st_records_exchange ON st_records (exchange);

-- 状态变更日志：用于「新增 / 状态变化时触发推送」
CREATE TABLE IF NOT EXISTS st_history (
  id          BIGSERIAL PRIMARY KEY,
  record_id   BIGINT NOT NULL REFERENCES st_records(id) ON DELETE CASCADE,
  token_id    BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  exchange    TEXT NOT NULL REFERENCES exchanges(code) ON DELETE CASCADE,
  from_status TEXT,                         -- NULL 表示新增
  to_status   TEXT NOT NULL,                -- ST | DelistRisk | Delisted | Removed（已消失/已恢复正常）
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_st_history_changed_at ON st_history (changed_at);
CREATE INDEX IF NOT EXISTS idx_st_history_notified ON st_history (notified);

-- 最近一次扫描时间（全局，用于看板展示）
CREATE TABLE IF NOT EXISTS scan_meta (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
