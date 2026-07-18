import {
  importClass,
  renderPhpFile,
  renderUseStatements,
  toClassName,
  type GeneratedFile,
  type NormalizedRecord,
  type NormalizedType,
  type PhpTargetAdapter,
  type RenderContext,
  type StructRenderRequest,
} from "@php-skir/generator-core";

import { GENERATOR_MODULE } from "./config.js";

const BASE_DATA = "StdOut\\SimpleDataObjects\\BaseData";

export class SimpleDataObjectsTarget implements PhpTargetAdapter {
  public readonly id = GENERATOR_MODULE;

  public recordClassName(record: NormalizedRecord): string {
    if (record.phpClassName !== undefined) {
      return record.phpClassName;
    }

    const className = toClassName(record.qualifiedName);

    return className.endsWith("Data") ? className : `${className}Data`;
  }

  public structImports(): readonly string[] {
    return [BASE_DATA];
  }

  public renderStruct({ record, context }: StructRenderRequest): GeneratedFile {
    if (record.recordType !== "struct") {
      throw new Error(`Cannot render non-struct record ${record.identity} as a struct.`);
    }

    const className = context.names.namesByIdentity.get(record.identity);

    if (className === undefined) {
      throw new Error(`No PHP class name was resolved for record ${record.identity}.`);
    }

    const baseData = importClass(context.imports, BASE_DATA);
    const body = [
      `final class ${className} extends ${baseData}`,
      "{",
      "}",
    ].join("\n");

    return {
      path: context.pathPrefix === ""
        ? `${className}.php`
        : `${context.pathPrefix}/${className}.php`,
      code: renderPhpFile({
        namespace: context.namespace,
        imports: renderUseStatements(context.imports, [BASE_DATA]),
        body,
      }),
    };
  }

  public phpType(type: NormalizedType): string {
    return unsupportedType(type);
  }

  public toSkirExpression(type: NormalizedType): string {
    return unsupportedType(type);
  }

  public fromSkirExpression(type: NormalizedType): string {
    return unsupportedType(type);
  }

  public clientResponseExpression(type: NormalizedType): string {
    return unsupportedType(type);
  }

  public manifestObjectClass(type: NormalizedType, context: RenderContext): string | null {
    return unsupportedType(type, context);
  }
}

function unsupportedType(type: NormalizedType, context?: RenderContext): never {
  const namespace = context === undefined ? "" : ` in ${context.namespace}`;

  throw new Error(`Simple Data Objects type ${type.kind} is not implemented${namespace}.`);
}
