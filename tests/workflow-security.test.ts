import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowStep {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly shell?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly "working-directory"?: string;
}

interface WorkflowJob {
  readonly if?: string;
  readonly name?: string;
  readonly needs?: string | readonly string[];
  readonly permissions?: Readonly<Record<string, string>>;
  readonly steps: readonly WorkflowStep[];
  readonly "timeout-minutes"?: number;
}

interface WorkflowDefinition {
  readonly jobs: Readonly<Record<string, WorkflowJob>>;
  readonly permissions?: Readonly<Record<string, string>>;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function workflow(name: string): WorkflowDefinition {
  return parse(
    readFileSync(resolve(repositoryRoot, ".github", "workflows", name), "utf8"),
  ) as WorkflowDefinition;
}

function workflowStep(job: WorkflowJob, name: string): WorkflowStep {
  const found = job.steps.find((step) => step.name === name);

  if (found === undefined) {
    throw new Error(`Missing workflow step: ${name}`);
  }

  return found;
}

function commandLines(step: WorkflowStep): string[] {
  if (step.run === undefined) {
    throw new Error(`Workflow step has no command: ${step.name ?? "unnamed"}`);
  }

  return step.run.trim().split("\n");
}

describe("workflow trust boundaries", () => {
  it("verifies the registry-resolved dependency graph and packed consumer before publishing", () => {
    const release = workflow("release.yml");

    expect(release.permissions).toEqual({ contents: "read" });
    expect(Object.keys(release.jobs)).toEqual(["verify", "publish"]);

    const verify = release.jobs.verify;

    expect(verify.permissions).toBeUndefined();
    expect(verify["timeout-minutes"]).toBe(15);
    expect(verify.steps.some((step) => step.with?.repository === "php-skir/generator-core")).toBe(false);
    expect(verify.steps.some((step) => step["working-directory"] === "generator-core")).toBe(false);
    expect(workflowStep(verify, "Install dependencies")).toEqual({
      name: "Install dependencies",
      "working-directory": "generator",
      run: "npm ci",
    });
    expect(commandLines(workflowStep(verify, "Create release package"))).toEqual([
      "mkdir -p build/package",
      "npm pack --ignore-scripts --pack-destination build/package --cache .npm-cache",
    ]);

    const smoke = workflowStep(verify, "Smoke test release package");

    expect(smoke.shell).toBe("bash");
    expect(smoke["working-directory"]).toBe("generator");
    expect(commandLines(smoke)).toEqual([
      "set -euo pipefail",
      'smoke_dir=$(mktemp -d "${RUNNER_TEMP}/skir-sdo-release.XXXXXX")',
      "trap 'rm -rf \"$smoke_dir\"' EXIT",
      "package_tarballs=(build/package/skir-simple-data-objects-generator-*.tgz)",
      'test "${#package_tarballs[@]}" -eq 1',
      'timeout 120s npm install --prefix "$smoke_dir" --ignore-scripts --no-audit --no-fund "${package_tarballs[0]}"',
      'cd "$smoke_dir"',
      'node --input-type=module --eval \'import { generateSimpleDataObjectsFiles } from "skir-simple-data-objects-generator"; const files = generateSimpleDataObjectsFiles({ modules: [] }); if (!Array.isArray(files)) throw new Error("Unexpected generator result.");\'',
    ]);
    expect(workflowStep(verify, "Upload verified release package")).toEqual({
      name: "Upload verified release package",
      uses: "actions/upload-artifact@v4",
      with: {
        name: "release-package",
        path: "generator/build/package/skir-simple-data-objects-generator-*.tgz",
        "if-no-files-found": "error",
      },
    });
  });

  it("limits the OIDC job to downloading and publishing the verified tarball", () => {
    const publish = workflow("release.yml").jobs.publish;

    expect(publish.needs).toBe("verify");
    expect(publish.permissions).toEqual({
      contents: "read",
      "id-token": "write",
    });
    expect(publish.steps).toEqual([
      {
        name: "Setup Node",
        uses: "actions/setup-node@v7",
        with: {
          "node-version": "24",
          "registry-url": "https://registry.npmjs.org",
          "package-manager-cache": false,
        },
      },
      {
        name: "Download verified release package",
        uses: "actions/download-artifact@v4",
        with: {
          name: "release-package",
          path: "release-package",
        },
      },
      {
        name: "Publish",
        run: "npm publish release-package/skir-simple-data-objects-generator-*.tgz --provenance --access public --ignore-scripts",
      },
    ]);
  });

  it("retains sibling-core compatibility in regular tests without using it for releases", () => {
    const testWorkflow = workflow("tests.yml");
    const tests = testWorkflow.jobs.tests;

    expect(testWorkflow.permissions).toEqual({ contents: "read" });
    expect(tests.permissions).toBeUndefined();

    expect(workflowStep(tests, "Checkout generator core")).toMatchObject({
      uses: "actions/checkout@v7",
      with: {
        repository: "php-skir/generator-core",
        path: "generator-core",
      },
    });
    expect(commandLines(workflowStep(tests, "Install dependencies"))).toEqual([
      "npm ci",
      "npm install --no-save --package-lock=false ../generator-core",
    ]);
    expect(workflowStep(tests, "Test coverage badge publisher")).toEqual({
      name: "Test coverage badge publisher",
      "working-directory": "generator",
      run: "bash .github/scripts/publish-coverage-badge.test.sh",
    });
  });

  it("keeps pull request coverage read-only and badge writes in a main-only job", () => {
    const tests = workflow("tests.yml");
    const coverage = tests.jobs.coverage;
    const badge = tests.jobs.badge;

    expect(tests.permissions).toEqual({ contents: "read" });
    expect(coverage.permissions).toBeUndefined();
    expect(workflowStep(coverage, "Measure coverage").run).toBe("npm run test:coverage");
    expect(workflowStep(coverage, "Upload coverage badge artifact").with?.name).toBe("coverage-badge");
    expect(badge.if).toBe("github.ref == 'refs/heads/main'");
    expect(badge.needs).toBe("coverage");
    expect(badge.permissions).toEqual({ contents: "write" });
    expect(workflowStep(badge, "Download coverage badge artifact").with?.name).toBe("coverage-badge");
  });
});
