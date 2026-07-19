import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const projectPaths: string[] = [];

function createProject(composerSource = "{}\n"): string {
  const projectPath = mkdtempSync(join(tmpdir(), "skir-sdo-composer-cli-"));
  projectPaths.push(projectPath);
  mkdirSync(join(projectPath, "generated", "skirout"), { recursive: true });
  writeFileSync(join(projectPath, "skir.yml"), [
    "generators:",
    "  - mod: skir-simple-data-objects-generator",
    "    outDir: generated/skirout",
    "",
  ].join("\n"));
  writeFileSync(join(projectPath, "composer.json"), composerSource);

  return projectPath;
}

afterEach(() => {
  for (const projectPath of projectPaths.splice(0)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

describe("configure-composer CLI", () => {
  it("prints usage errors with a non-zero status", () => {
    const result = spawnSync(process.execPath, [resolve("dist/cli.js"), "unknown"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/usage: skir-simple-data-objects-generator configure-composer/i);
  });

  it("adds the mapping and prints the Composer follow-up command", () => {
    const projectPath = createProject();
    const result = spawnSync(process.execPath, [
      resolve("dist/cli.js"),
      "configure-composer",
      "--root",
      projectPath,
    ], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Added Composer PSR-4 mapping Skir\\ => generated/skirout/");
    expect(result.stdout).toContain("composer dump-autoload");
    expect(result.stderr).toBe("");
    expect(JSON.parse(readFileSync(join(projectPath, "composer.json"), "utf8"))
      .autoload["psr-4"]["Skir\\"]).toBe("generated/skirout/");
  });
});
