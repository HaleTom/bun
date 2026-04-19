// https://github.com/oven-sh/bun/issues/29436
//
// Sending a UDP datagram to a port with no listener on Linux generates an
// ICMP "port unreachable". With IP_RECVERR enabled the kernel queues this on
// the socket's error queue and raises EPOLLERR. The error queue must be read
// with recvmsg(MSG_ERRQUEUE) — plain recvmsg reports the pending error once
// but does not dequeue it, so EPOLLERR stays level-triggered and epoll_wait
// busy-loops at 100% CPU forever.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

// IP_RECVERR is Linux-only; on other platforms the send either silently
// succeeds (no ICMP surfaced on unconnected sockets) or errors synchronously.
test.skipIf(!isLinux)("Bun.udpSocket: ICMP error does not busy-loop the event loop", async () => {
  const script = /* js */ `
    let errorCount = 0;
    let errorCode;
    const { promise: gotError, resolve } = Promise.withResolvers();
    const socket = await Bun.udpSocket({
      socket: {
        error(err) {
          errorCount++;
          errorCode ??= err?.code;
          resolve();
        },
      },
    });
    // Pick an ephemeral port nothing is listening on by binding+closing a
    // throwaway socket.
    const probe = await Bun.udpSocket({});
    const deadPort = probe.port;
    probe.close();

    socket.send("x", deadPort, "127.0.0.1");
    await Promise.race([gotError, Bun.sleep(2000)]);

    // Measure CPU time consumed while the process should be idle. With the
    // bug, the event loop spins and CPU time ~= wall time.
    const wallMs = 1000;
    const before = process.cpuUsage();
    await Bun.sleep(wallMs);
    const after = process.cpuUsage(before);
    const cpuMs = (after.user + after.system) / 1000;

    socket.close();
    console.log(JSON.stringify({ errorCount, errorCode, cpuMs, wallMs }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  // The error handler should fire exactly once per ICMP error, not zero
  // (event swallowed) and not unbounded (re-fired every loop tick).
  expect(result.errorCount).toBe(1);
  expect(result.errorCode).toBe("ECONNREFUSED");
  // The buggy build burns ~100% CPU (cpuMs ≈ wallMs). A fixed build idles;
  // even under debug/ASAN it stays well below 75% of wall time.
  expect(result.cpuMs).toBeLessThan(result.wallMs * 0.75);
  expect(exitCode).toBe(0);
});

test.skipIf(!isLinux)("node:dgram: ICMP error does not busy-loop the event loop", async () => {
  const script = /* js */ `
    const dgram = require("node:dgram");
    let errorCount = 0;
    let errorCode;
    const { promise: gotError, resolve } = Promise.withResolvers();
    const sock = dgram.createSocket("udp4");
    sock.on("error", err => {
      errorCount++;
      errorCode ??= err?.code;
      resolve();
    });
    const probe = dgram.createSocket("udp4");
    await new Promise(r => probe.bind(0, "127.0.0.1", r));
    const deadPort = probe.address().port;
    await new Promise(r => probe.close(r));

    sock.send("x", deadPort, "127.0.0.1");
    await Promise.race([gotError, Bun.sleep(2000)]);

    const wallMs = 1000;
    const before = process.cpuUsage();
    await Bun.sleep(wallMs);
    const after = process.cpuUsage(before);
    const cpuMs = (after.user + after.system) / 1000;

    sock.close();
    console.log(JSON.stringify({ errorCount, errorCode, cpuMs, wallMs }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.errorCount).toBe(1);
  expect(result.errorCode).toBe("ECONNREFUSED");
  expect(result.cpuMs).toBeLessThan(result.wallMs * 0.75);
  expect(exitCode).toBe(0);
});
