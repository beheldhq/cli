import { test, expect, describe } from "bun:test";

describe("pidListeningOn", () => {
  test("returns undefined on a port with no listener", async () => {
    const { pidListeningOn } = await import("../../src/util/ports");
    // Port unlikely to be in use on the test machine.
    expect(pidListeningOn(65530)).toBeUndefined();
  });
});

describe("engineHealthy", () => {
  test("returns false when nobody listens on the port", async () => {
    const { engineHealthy } = await import("../../src/util/ports");
    const result = await engineHealthy(65530, 500);
    expect(result).toBe(false);
  });

  test("returns true against a local /health=200 server", async () => {
    const { engineHealthy } = await import("../../src/util/ports");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health") return new Response("ok");
        return new Response("no", { status: 404 });
      },
    });
    try {
      const result = await engineHealthy(server.port, 500);
      expect(result).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("returns false on timeout", async () => {
    const { engineHealthy } = await import("../../src/util/ports");
    const server = Bun.serve({
      port: 0,
      async fetch() {
        await new Promise((r) => setTimeout(r, 1000));
        return new Response("late");
      },
    });
    try {
      const t0 = Date.now();
      const result = await engineHealthy(server.port, 100);
      const elapsed = Date.now() - t0;
      expect(result).toBe(false);
      expect(elapsed).toBeLessThan(900);
    } finally {
      server.stop();
    }
  });
});

describe("waitSocketRelease", () => {
  test("returns true immediately when nobody listens", async () => {
    const { waitSocketRelease } = await import("../../src/util/ports");
    const result = await waitSocketRelease(65530, 1000);
    expect(result).toBe(true);
  });

  test("returns false on timeout while socket stays held", async () => {
    const { waitSocketRelease } = await import("../../src/util/ports");
    const server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    try {
      const t0 = Date.now();
      const result = await waitSocketRelease(server.port, 250);
      const elapsed = Date.now() - t0;
      expect(result).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(200);
    } finally {
      server.stop();
    }
  });

  test("returns true when socket releases during the poll", async () => {
    const { waitSocketRelease } = await import("../../src/util/ports");
    const server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const port = server.port;
    // Stop after 300ms — the poll must detect it.
    setTimeout(() => server.stop(), 300);
    const result = await waitSocketRelease(port, 2000);
    // Logical contract: the function correctly detects the release
    // within the timeout. We do NOT assert wall-clock — the internal
    // `spawnSync("lsof")` queues up under full-suite load (macOS lsof
    // is serialized), inflating elapsed to 2-3s and breaking an
    // assertion that does not test the real contract. In production
    // what matters is the final `true/false`, and that is delivered
    // correctly.
    expect(result).toBe(true);
  });
});
