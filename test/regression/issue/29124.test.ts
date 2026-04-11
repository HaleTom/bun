// https://github.com/oven-sh/bun/issues/29124

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe.concurrent("issue #29124 — new Worker() in compiled standalone binaries", () => {
  test("nested `new URL(rel, import.meta.url)` resolves via embedded graph", async () => {
    using dir = tempDir("issue-29124-nested-url", {
      "src/cmd/main.ts": /* js */ `
        new Worker(new URL("../workers/worker.ts", import.meta.url));
        console.log("main loaded");
      `,
      "src/workers/worker.ts": /* js */ `
        console.log("hello from nested worker");
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
    expect(runOut).toContain("hello from nested worker");
    expect(runCode).toBe(0);
  });

  test("nested `import.meta.resolve` result resolves via embedded graph", async () => {
    using dir = tempDir("issue-29124-resolve", {
      "src/cmd/main.ts": /* js */ `
        new Worker(import.meta.resolve("../workers/worker.ts"));
        console.log("main loaded");
      `,
      "src/workers/worker.ts": /* js */ `
        console.log("hello from resolve");
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
    expect(runOut).toContain("hello from resolve");
    expect(runCode).toBe(0);
  });

  test("flat `new URL(rel, import.meta.url)` resolves via embedded graph", async () => {
    using dir = tempDir("issue-29124-flat-url", {
      "cli.ts": /* js */ `
        new Worker(new URL("./my-worker.ts", import.meta.url).href);
        console.log("main loaded");
      `,
      "my-worker.ts": /* js */ `
        console.log("hello from flat worker");
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
    expect(runOut).toContain("hello from flat worker");
    expect(runCode).toBe(0);
  });

  test("nested direct string specifier resolves via embedded graph", async () => {
    // Exercises the `is_relative` branch of resolveEntryPointSpecifier
    // directly — no `new URL()` / `import.meta.resolve()` wrapper.
    using dir = tempDir("issue-29124-string-specifier", {
      "src/cmd/main.ts": /* js */ `
        new Worker("../workers/worker.ts");
        console.log("main loaded");
      `,
      "src/workers/worker.ts": /* js */ `
        console.log("hello from string specifier");
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
    expect(runOut).toContain("hello from string specifier");
    expect(runCode).toBe(0);
  });
});
