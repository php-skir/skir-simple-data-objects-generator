import { type CodeGenerator } from "skir-internal";

import { GeneratorConfig, GENERATOR_MODULE } from "./config.js";
import { generateSimpleDataObjectsFiles } from "./generator.js";

class SimpleDataObjectsGenerator implements CodeGenerator<GeneratorConfig> {
  readonly id = GENERATOR_MODULE;
  readonly configType: CodeGenerator<GeneratorConfig>["configType"] = GeneratorConfig;

  generateCode(input: CodeGenerator.Input<GeneratorConfig>): CodeGenerator.Output {
    return {
      files: generateSimpleDataObjectsFiles(input),
    };
  }
}

export const GENERATOR = new SimpleDataObjectsGenerator();

export { generateSimpleDataObjectsFiles };
export { SimpleDataObjectsTarget } from "./target.js";
export default GENERATOR;
