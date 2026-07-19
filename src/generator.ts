import {
  generatePhp,
  PHP_FILE_HEADER,
  type CoreGeneratorInput,
  type GeneratedFile,
} from "@php-skir/generator-core";

import {
  GeneratorConfig,
  type GeneratorConfigInput,
} from "./config.js";
import { SimpleDataObjectsTarget } from "./target.js";

export { PHP_FILE_HEADER };

export type PhpGeneratorConfig = GeneratorConfigInput;

export interface PhpGeneratorInput extends CoreGeneratorInput {
  readonly config?: PhpGeneratorConfig;
}

export function generateSimpleDataObjectsFiles(input: PhpGeneratorInput): GeneratedFile[] {
  const { namespace, validation = {} } = GeneratorConfig.parse(input.config ?? {});

  return generatePhp({
    ...input,
    namespace,
    adapter: new SimpleDataObjectsTarget(validation),
  });
}

export type {
  GeneratedFile,
  SkirField,
  SkirMethod,
  SkirModule,
  SkirRecord,
  SkirRecordLocation,
  SkirRecordNamePart,
  SkirToken,
  SkirType,
} from "@php-skir/generator-core";
