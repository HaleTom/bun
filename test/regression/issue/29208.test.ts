// https://github.com/oven-sh/bun/issues/29208
//
// MySQL DATETIME/TIMESTAMP values were deserialized through JSC's local-time
// constructor, so on any machine whose process TZ was not UTC the returned
// JS `Date` was off by the client's UTC offset. `bun test` forces
// TZ=Etc/UTC on the test runner, which masks the bug, so we set
// process.env.TZ before decoding and round-trip both DATETIME and TIMESTAMP
// via the binary (prepared) and text (simple) protocols.

import { SQL, randomUUIDv7 } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

const EXPECTED_ISO = "2024-01-15T05:30:45.678Z" as const;

async function runRoundTrip(url: string) {
  // Apply the non-UTC TZ *before* any Date is constructed or SQL query is
  // decoded — JSC's date cache reads $TZ lazily on its first use.
  const savedTz = process.env.TZ;
  process.env.TZ = "Asia/Bangkok";

  try {
    // With TZ=Asia/Bangkok (UTC+7, no DST) the local-time constructor
    // interprets (2024, 0, 15, 12, 30, 45, 678) as
    // 2024-01-15T12:30:45.678+07:00 = 2024-01-15T05:30:45.678Z.
    const sent = new Date(2024, 0, 15, 12, 30, 45, 678);
    expect(sent.toISOString()).toBe(EXPECTED_ISO);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Asia/Bangkok");

    await using sql = new SQL({ url, max: 1 });
    const tableName = "ts_29208_" + randomUUIDv7("hex").replaceAll("-", "");

    await sql`DROP TABLE IF EXISTS ${sql(tableName)}`;
    await sql`CREATE TABLE ${sql(tableName)} (id INT PRIMARY KEY, ts DATETIME(3), tstz TIMESTAMP(3))`;

    try {
      await sql`INSERT INTO ${sql(tableName)} (id, ts, tstz) VALUES (${1}, ${sent}, ${sent})`;

      // Binary (prepared statement) protocol.
      const [bin] = (await sql`SELECT ts, tstz FROM ${sql(tableName)} WHERE id = 1`) as any[];
      // Text (simple query) protocol.
      const [txt] = (await sql`SELECT ts, tstz FROM ${sql(tableName)} WHERE id = 1`.simple()) as any[];

      // Every column — binary and text, DATETIME and TIMESTAMP — must decode
      // to the same UTC instant the client sent.
      expect({
        binaryDatetime: (bin.ts as Date).toISOString(),
        binaryTimestamp: (bin.tstz as Date).toISOString(),
        textDatetime: (txt.ts as Date).toISOString(),
        textTimestamp: (txt.tstz as Date).toISOString(),
      }).toEqual({
        binaryDatetime: EXPECTED_ISO,
        binaryTimestamp: EXPECTED_ISO,
        textDatetime: EXPECTED_ISO,
        textTimestamp: EXPECTED_ISO,
      });
    } finally {
      await sql`DROP TABLE IF EXISTS ${sql(tableName)}`;
    }
  } finally {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  }
}

// ─── Docker path (used in CI) ───────────────────────────────────────────────
if (isDockerEnabled()) {
  describeWithContainer("issue #29208 (containerized MySQL)", { image: "mysql_plain", concurrent: true }, container => {
    beforeAll(() => container.ready);
    test("DATETIME/TIMESTAMP decode as UTC under non-UTC TZ", async () => {
      await runRoundTrip(`mysql://root@${container.host}:${container.port}/bun_sql_test`);
    });
  });
}

// ─── Local-server path (used in dev/reproduction shells without Docker) ────
//
// Detection order:
//   1. BUN_TEST_LOCAL_MYSQL_URL — explicit override.
//   2. mysql://bun_test:bun_test_pw@127.0.0.1:3306/bun_sql_test — the farm
//      convention; auto-provisioned via `mysql -u root` if reachable.
//
// Skipped cleanly if neither is available.
describe("issue #29208 (local MySQL)", () => {
  let resolvedUrl: string | undefined;

  beforeAll(async () => {
    const explicitUrl = process.env.BUN_TEST_LOCAL_MYSQL_URL;
    if (explicitUrl) {
      resolvedUrl = explicitUrl;
      return;
    }

    // Idempotently auto-provision the farm-convention user. If the mysql
    // CLI is missing or root isn't trusted, provisioning fails silently and
    // the test becomes a no-op.
    try {
      await using proc = Bun.spawn({
        cmd: ["mysql", "-u", "root"],
        stdin: new TextEncoder().encode(
          `CREATE DATABASE IF NOT EXISTS bun_sql_test;
           CREATE USER IF NOT EXISTS 'bun_test'@'%' IDENTIFIED BY 'bun_test_pw';
           GRANT ALL ON bun_sql_test.* TO 'bun_test'@'%';
           FLUSH PRIVILEGES;`,
        ),
        stdout: "ignore",
        stderr: "ignore",
      });
      if ((await proc.exited) === 0) {
        resolvedUrl = "mysql://bun_test:bun_test_pw@127.0.0.1:3306/bun_sql_test";
      }
    } catch {
      // mysql CLI unavailable — no local server path, rely on Docker above.
    }
  });

  test("DATETIME/TIMESTAMP decode as UTC under non-UTC TZ", async () => {
    if (!resolvedUrl) {
      // No local MySQL — skip cleanly. CI relies on the Docker path above.
      return;
    }
    await runRoundTrip(resolvedUrl);
  });
});
