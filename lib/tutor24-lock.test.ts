import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { acquireTutor24Lock } from "./tutor24-lock";

it("sperrt einen zweiten Lauf, gibt frei und raeumt verwaiste Sperren auf", () => {
  const path = join(mkdtempSync(join(tmpdir(), "t24lock-")), ".tutor24.lock");
  const release = acquireTutor24Lock("erstnachrichten", path);
  expect(() => acquireTutor24Lock("nachfassen", path)).toThrow(/erstnachrichten/);
  release();
  expect(existsSync(path)).toBe(false);

  writeFileSync(path, JSON.stringify({ owner: "abgestuerzt", pid: 999999999 }));
  acquireTutor24Lock("nachfassen", path)();
  expect(existsSync(path)).toBe(false);
});
