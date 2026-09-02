import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE GUARD ON THE OWNER'S umi EXCEPTION (`docs/decisions.md` Q21).
 *
 * umi is allowed in this project for exactly two server-side jobs — creating a
 * candy machine and uploading to Irys — and is not allowed to reach a browser.
 * The reason it was let in at all is that a candy machine's guard set is a
 * variable-length, order-sensitive structure that has to be written AND read
 * back, and getting it wrong produces permanent on-chain state paid for by
 * somebody else. None of that reasoning applies to the browser, which signs
 * transactions this server built and simulated.
 *
 * **A rule with no instrument is a preference.** `solana-standard.ts` records
 * what the last dependency audit cost this project — 419 packages down to 163,
 * and every advisory gone — so "server only" needs to be a thing that fails a
 * run rather than a thing everyone remembers.
 *
 * **It walks the import graph rather than grepping the client files**, because
 * the way umi would actually reach a browser is not `import { umi } from ...`
 * in a `.tsx`: it is a client component importing a helper in `lib/` that
 * imports it, three files down, on a path nobody was thinking about.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** Anything built on umi. The candy machine client IS umi, so banning one and
 *  allowing the other would be a hole rather than a rule. */
const FORBIDDEN = /^@metaplex-foundation\//;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const ALL = sourceFiles(SRC);
const rel = (f: string) => f.replace(ROOT + "/", "");

/** Every `from "…"` in a file, import or re-export. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]!);
}

/** Resolves a relative import the way the bundler would: exact, then extensions, then index. */
function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Files carrying the "use client" directive: every entry point into a browser bundle. */
const CLIENT_ENTRIES = ALL.filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));

/** Everything reachable from a client entry, and the bare packages it pulls in. */
function clientClosure(): { files: Set<string>; packages: Map<string, string[]> } {
  const files = new Set<string>();
  const packages = new Map<string, string[]>();
  const queue = [...CLIENT_ENTRIES];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    for (const spec of importsOf(file)) {
      if (spec.startsWith(".")) {
        const local = resolveLocal(file, spec);
        if (local) queue.push(local);
        continue;
      }
      packages.set(spec, [...(packages.get(spec) ?? []), rel(file)]);
    }
  }
  return { files, packages };
}

describe("umi is a server dependency and stays one", () => {
  it("finds client entry points to walk from", () => {
    // The control. A walk that starts nowhere ends nowhere, and an empty
    // forbidden-package list would then read exactly like a clean bill of
    // health — which is the shape a broken check takes most often.
    expect(CLIENT_ENTRIES.length).toBeGreaterThan(0);
  });

  it("reaches the wallet plumbing from a client entry", () => {
    // A second control, on the walk itself rather than on its starting points:
    // `useSolanaWallet` is imported by a client component through a relative
    // path, so a resolver that quietly returned null for everything would fail
    // here rather than passing the real assertion below.
    const { files } = clientClosure();
    expect([...files].map(rel)).toContain("src/components/useSolanaWallet.ts");
  });

  it("pulls no @metaplex-foundation package into any client bundle", () => {
    const { packages } = clientClosure();
    const offenders = [...packages.entries()]
      .filter(([spec]) => FORBIDDEN.test(spec))
      .map(([spec, importers]) => `${spec} (imported by ${importers.join(", ")})`);

    expect(offenders).toEqual([]);
  });
});
