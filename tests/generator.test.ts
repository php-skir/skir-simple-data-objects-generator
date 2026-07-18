import { describe, expect, it } from "vitest";

import { PHP_FILE_HEADER, generateSimpleDataObjectsFiles } from "../src/generator.js";

describe("generateSimpleDataObjectsFiles", () => {
  it("generates an empty BaseData class with the stable Data suffix", () => {
    const files = generateSimpleDataObjectsFiles({
      modules: [
        {
          path: "health/health.skir",
          records: [
            {
              kind: "struct",
              name: "HealthRequest",
              fields: [],
            },
          ],
        },
      ],
    });
    const struct = files.find((file) => file.path === "Health/HealthRequestData.php");

    expect(struct?.code).toContain(`declare(strict_types=1);\n\n${PHP_FILE_HEADER}`);
    expect(struct?.code).toContain("namespace Skir\\Health;");
    expect(struct?.code).toContain("use StdOut\\SimpleDataObjects\\BaseData;");
    expect(struct?.code).toContain("final class HealthRequestData extends BaseData");
    expect(struct?.code).not.toContain("__construct");
  });
});
