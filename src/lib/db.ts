import { Pool, type PoolClient } from "pg";

/**
 * 全局 Postgres 连接池。
 * Next.js 开发模式下 HMR 会重复加载模块，这里用 globalThis 兜底，避免连接泄漏。
 *
 * 注意：pool 采用「懒加载」——模块导入时不创建，
 * 只在第一次真正查询时才读取 DATABASE_URL 并建池。
 * 这样 build 期收集页面数据（会 import 路由）时不会因缺少 env 而报错。
 */
declare global {
  var __stscanPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("缺少环境变量 DATABASE_URL（Postgres 连接串）");
  }
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // 多数托管 Postgres（Neon/Supabase/Railway）要求 sslmode=require
    ssl: connectionString.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

/** 获取（必要时创建）共享连接池 */
export function getPool(): Pool {
  if (!globalThis.__stscanPool) {
    globalThis.__stscanPool = createPool();
  }
  return globalThis.__stscanPool;
}

/** 便捷查询封装 */
export function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[]
) {
  return getPool().query<T>(text, params);
}


/** 在事务里执行多个操作 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
