// https://github.com/oven-sh/bun/issues/29124
//
// `new Worker(new URL("./nested/worker.ts", import.meta.url))` in a
// `bun build --compile` standalone binary resolved to
// `/$bunfs/nested/worker.ts` — missing the `root/` prefix that the
// embedded module graph uses — and `resolveEntryPointSpecifier` only
// rewrote `.ts → .js` for `./` / `../` inputs. The result was a
// `ModuleNotFound` error at runtime. Verify all four forms the docs
// show (`./foo.ts`, `./nested/foo.ts` string, `new URL()`, and
// `import.meta.resolve`) work in standalone binaries.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe.concurrent("issue #29124 — new Worker() in compiled standalone binaries", () => {
  test("nested `new URL(rel, import.meta.url)` resolves via embedded graph", async () => {
    using dir = tempDir("issue-29124-nested-url", {
      "src/cmd/main.ts": /* js */ `
        const worker = new Worker(new URL("../workers/worker.ts", import.meta.url));
        worker.addEventListener("message", (e) => {
          console.log("msg:", e.data);
          worker.terminate();
        });
        worker.addEventListener("error", (e) => {
          console.log("error:", e.message);
          process.exit(1);
        });
      `,
      "src/workers/worker.ts": /* js */ `
        postMessage("hello from nested worker");
      `,
    });

    const outfile = join(String(dir), "myapp");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "./src/cmd/main.ts", "./src/workers/worker.ts", "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , buildCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildCode).toBe(0);

    await using run = Bun.spawn({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [runOut, runErr, runCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(runErr).not.toContain("ModuleNotFound");
    expect(runErr).not.toContain("BuildMessage");
    expect(runOut).toContain("msg: hello from nested worker");
    expect(runCode).toBe(0);
  });

  test("nested `import.meta.resolve` result resolves via embedded graph", async () => {
    using dir = tempDir("issue-29124-resolve", {
      "src/cmd/main.ts": /* js */ `
        const href = import.meta.resolve("../workers/worker.ts");
        const worker = new Worker(href);
        worker.addEventListener("message", (e) => {
          console.log("msg:", e.data);
          worker.terminate();
        });
        worker.addEventListener("error", (e) => {
          console.log("error:", e.message);
          process.exit(1);
        });
      `,
      "src/workers/worker.ts": /* js */ `
        postMessage("hello from resolve");
      `,
    });

    const outfile = join(String(dir), "myapp");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "./src/cmd/main.ts", "./src/workers/worker.ts", "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const buildCode = await build.exited;
    expect(buildCode).toBe(0);

    await using run = Bun.spawn({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [runOut, runErr, runCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(runErr).not.toContain("ModuleNotFound");
    expect(runErr).not.toContain("BuildMessage");
    expect(runOut).toContain("msg: hello from resolve");
    expect(runCode).toBe(0);
  });

  test("flat `new URL(rel, import.meta.url)` resolves via embedded graph", async () => {
    // Also covers the docs example at
    // https://bun.com/docs/bundler/executables#worker which the
    // issue author reported works but actually also hit the same bug.
    using dir = tempDir("issue-29124-flat-url", {
      "cli.ts": /* js */ `
        const worker = new Worker(new URL("./my-worker.ts", import.meta.url).href);
        worker.addEventListener("message", (e) => {
          console.log("msg:", e.data);
          worker.terminate();
        });
        worker.addEventListener("error", (e) => {
          console.log("error:", e.message);
          process.exit(1);
        });
      `,
      "my-worker.ts": /* js */ `
        postMessage("hello from flat worker");
      `,
    });

    const outfile = join(String(dir), "cli");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "cli.ts", "my-worker.ts", "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const buildCode = await build.exited;
    expect(buildCode).toBe(0);

    await using run = Bun.spawn({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [runOut, runErr, runCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(runErr).not.toContain("ModuleNotFound");
    expect(runErr).not.toContain("BuildMessage");
    expect(runOut).toContain("msg: hello from flat worker");
    expect(runCode).toBe(0);
  });

  test("nested direct string specifier resolves via embedded graph", async () => {
    // Exercises the `is_relative` branch of resolveEntryPointSpecifier
    // directly — no `new URL()` / `import.meta.resolve()` wrapper.
    using dir = tempDir("issue-29124-string-specifier", {
      "src/cmd/main.ts": /* js */ `
        const worker = new Worker("../workers/worker.ts");
        worker.addEventListener("message", (e) => {
          console.log("msg:", e.data);
          worker.terminate();
        });
        worker.addEventListener("error", (e) => {
          console.log("error:", e.message);
          process.exit(1);
        });
      `,
      "src/workers/worker.ts": /* js */ `
        postMessage("hello from string specifier");
      `,
    });

    const outfile = join(String(dir), "myapp");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "./src/cmd/main.ts", "./src/workers/worker.ts", "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const buildCode = await build.exited;
    expect(buildCode).toBe(0);

    await using run = Bun.spawn({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [runOut, runErr, runCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(runErr).not.toContain("ModuleNotFound");
    expect(runErr).not.toContain("BuildMessage");
    expect(runOut).toContain("msg: hello from string specifier");
    expect(runCode).toBe(0);
  });
});
