import { describe, expect, it } from "vitest";

import { DEFAULT_NAMESPACE, GENERATOR_MODULE, GeneratorConfig } from "../src/config.js";

describe("GeneratorConfig", () => {
  it("uses the Simple Data Objects module ID and Skir default namespace", () => {
    expect(GENERATOR_MODULE).toBe("skir-simple-data-objects-generator");
    expect(DEFAULT_NAMESPACE).toBe("Skir");
    expect(GeneratorConfig.parse({}).namespace).toBe("Skir");
  });

  it("emits both client and server files by default and accepts one side only", () => {
    expect(GeneratorConfig.parse({}).emit).toBe("both");
    expect(GeneratorConfig.parse({ emit: "client" }).emit).toBe("client");
    expect(GeneratorConfig.parse({ emit: "server" }).emit).toBe("server");
    expect(GeneratorConfig.safeParse({ emit: "none" }).success).toBe(false);
  });

  it("accepts validation overlays while retaining strict configuration", () => {
    expect(GeneratorConfig.parse({
      namespace: "Company\\Contracts",
      validation: {
        "health/health.skir": {
          HealthRequest: {
            probe: ["required", "string"],
          },
        },
      },
    })).toEqual({
      namespace: "Company\\Contracts",
      emit: "both",
      validation: {
        "health/health.skir": {
          HealthRequest: {
            probe: ["required", "string"],
          },
        },
      },
    });
    expect(GeneratorConfig.safeParse({ unexpected: true }).success).toBe(false);
    expect(GeneratorConfig.safeParse({
      validation: {
        "health/health.skir": {
          HealthRequest: {
            probe: [],
          },
        },
      },
    }).success).toBe(false);
  });
});
