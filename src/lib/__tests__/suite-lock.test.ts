import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readHolder, takeSuiteLock } from "../../../suite-lock";

/**
 * The machine-wide queue, and the three properties the whole design rests on.
 *
 * It runs against a lock file in a temporary directory rather than the real one
 * in `~/.claude` — this suite is holding the real one while it runs, and a test
 * that took it again would deadlock against itself.
 */

const room = mkdtempSync(join(tmpdir(), "suite-lock-"));
const LOCK = join(room, "suite.lock");

afterAll(() => rmSync(room, { recursive: true, force: true }));

/** A second process that takes the lock and holds it until it is killed. */
function holderProcess(path: string): { pid: number; stop: () => void } {
  const source =
    `const fs=require("fs");` +
    `fs.openSync(${JSON.stringify(path)}, fs.constants.O_CREAT|fs.constants.O_RDWR|0x20|fs.constants.O_NONBLOCK);` +
    `fs.writeFileSync(${JSON.stringify(path)}, JSON.stringify({repo:"another-repo",pid:process.pid,startedAt:new Date().toISOString()}));` +
    `setTimeout(()=>{}, 120000);`;
  const child = spawn(process.execPath, ["-e", source], { stdio: "ignore" });
  // The child has to have opened the file before the assertions run. A short
  // poll rather than a sleep, so this is not a timing test.
  const until = Date.now() + 5_000;
  while (Date.now() < until && readHolder(path) === null) execFileSync("sleep", ["0.05"]);
  return { pid: child.pid!, stop: () => child.kill("SIGKILL") };
}

describe("the machine-wide suite lock", () => {
  it("waits for a holder rather than refusing, and says who has it", async () => {
    const other = holderProcess(LOCK);
    const said: string[] = [];

    try {
      await expect(
        takeSuiteLock({ path: LOCK, capMs: 300, pollMs: 50, announce: (m: string) => said.push(m) }),
      ).rejects.toThrow(/waiting for the machine-wide suite lock/);

      // The wait is announced once, and it names the repository and the PID —
      // a lock that fails anonymously sends you looking in the wrong project.
      expect(said).toHaveLength(1);
      expect(said[0]).toContain("another-repo");
      expect(said[0]).toContain(`pid ${other.pid}`);
    } finally {
      other.stop();
    }
  });

  /**
   * The property that makes this a lock rather than a sentinel file: nobody has
   * to notice that a holder died, and there is no stale-PID rule to get wrong.
   */
  it("is released by a holder that is killed, with nothing to clean up", async () => {
    const other = holderProcess(LOCK);
    other.stop();

    // No poll and no grace period: the kernel drops the lock with the process.
    const mine = await takeSuiteLock({ path: LOCK, capMs: 5_000, pollMs: 50, announce: () => {} });
    try {
      expect(mine.skipped).toBe(false);
      expect(readHolder(LOCK)).toMatchObject({ pid: process.pid });
    } finally {
      mine.release();
    }
  });

  it("hands the lock straight to the next taker on release", async () => {
    const first = await takeSuiteLock({ path: LOCK, capMs: 1_000, pollMs: 50, announce: () => {}, repo: "first" });
    expect(readHolder(LOCK)).toMatchObject({ repo: "first" });
    first.release();

    const second = await takeSuiteLock({ path: LOCK, capMs: 1_000, pollMs: 50, announce: () => {}, repo: "second" });
    try {
      expect(readHolder(LOCK)).toMatchObject({ repo: "second" });
    } finally {
      second.release();
    }
  });

  it("releases once however many times it is asked", async () => {
    const mine = await takeSuiteLock({ path: LOCK, capMs: 1_000, pollMs: 50, announce: () => {} });
    mine.release();
    // A second release must not close a descriptor number this process has
    // since reused for something else.
    expect(() => mine.release()).not.toThrow();
  });
});
