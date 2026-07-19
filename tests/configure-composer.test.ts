import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { configureComposer } from "../src/configure-composer.js";

const projectPaths: string[] = [];

function createProject(lines: readonly string[] = [
  "generators:",
  "  - mod: skir-simple-data-objects-generator",
  "    outDir: generated/skirout",
  "",
]): string {
  const projectPath = mkdtempSync(join(tmpdir(), "skir-sdo-composer-config-"));
  projectPaths.push(projectPath);
  writeFileSync(join(projectPath, "skir.yml"), lines.join("\n"));
  writeFileSync(join(projectPath, "composer.json"), '{\n  "require": {}\n}\n');

  return projectPath;
}

afterEach(() => {
  for (const projectPath of projectPaths.splice(0)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

describe("configureComposer", () => {
  it("delegates the SDO module contract and updates Composer atomically and idempotently", async () => {
    const projectPath = createProject();
    mkdirSync(join(projectPath, "generated", "skirout"), { recursive: true });

    const added = await configureComposer({ root: projectPath });
    const afterAdded = readFileSync(join(projectPath, "composer.json"), "utf8");
    const unchanged = await configureComposer({ root: projectPath });

    expect(added).toMatchObject({
      changed: true,
      namespace: "Skir\\",
      paths: "generated/skirout/",
    });
    expect(unchanged.changed).toBe(false);
    expect(readFileSync(join(projectPath, "composer.json"), "utf8")).toBe(afterAdded);
  });

  it("supports an explicit namespace and leaves Composer unchanged on conflict", async () => {
    const projectPath = createProject([
      "generators:",
      "  - mod: skir-simple-data-objects-generator",
      "    outDir: generated/skirout",
      "    config:",
      '      namespace: "Company\\\\Contracts"',
      "",
    ]);
    mkdirSync(join(projectPath, "generated", "skirout"), { recursive: true });
    const source = '{\n  "autoload": {"psr-4": {"Company\\\\Contracts\\\\": "src/"}}\n}\n';
    writeFileSync(join(projectPath, "composer.json"), source);

    await expect(configureComposer({ root: projectPath })).rejects.toThrow(/conflict/i);
    expect(readFileSync(join(projectPath, "composer.json"), "utf8")).toBe(source);
  });

  it("rejects output symlinks that escape the project root", async () => {
    const projectPath = createProject([
      "generators:",
      "  - mod: skir-simple-data-objects-generator",
      "    outDir: linked-skirout",
      "",
    ]);
    const outsidePath = createProject();
    symlinkSync(outsidePath, join(projectPath, "linked-skirout"), "dir");

    await expect(configureComposer({ root: projectPath })).rejects.toThrow(/escapes.*root/i);
  });
});
