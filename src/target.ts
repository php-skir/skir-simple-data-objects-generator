import {
  importClass,
  importClassAs,
  indent,
  renderPhpFile,
  renderUseStatements,
  resolveValidationRules,
  toClassName,
  toPhpNamespaceSegment,
  toPropertyName,
  type GeneratedFile,
  type NormalizedField,
  type NormalizedMethod,
  type NormalizedRecord,
  type NormalizedSchema,
  type NormalizedType,
  type PhpTargetAdapter,
  type RenderContext,
  type ResolvedValidationRules,
  type StructRenderRequest,
  type ValidationConfig,
} from "@php-skir/generator-core";

import { GENERATOR_MODULE } from "./config.js";
import { structuralRules } from "./structural-rules.js";

const DENSE_JSON = "Skir\\Runtime\\DenseJson";
const FIELD = "Skir\\Runtime\\Field";
const TYPE = "Skir\\Runtime\\Type";
const DATA_COLLECTION = "StdOut\\SimpleDataObjects\\Attributes\\DataCollection";
const MAP_PROPERTY_NAME = "StdOut\\SimpleDataObjects\\Attributes\\MapPropertyName";
const RULES = "StdOut\\SimpleDataObjects\\Attributes\\Rules";
const BASE_DATA = "StdOut\\SimpleDataObjects\\BaseData";
const TYPED_DATA_COLLECTION = "StdOut\\SimpleDataObjects\\TypedDataCollection";
const BASE_STRUCT_IMPORTS = [DENSE_JSON, FIELD, TYPE, BASE_DATA] as const;

export class SimpleDataObjectsTarget implements PhpTargetAdapter {
  public readonly id = GENERATOR_MODULE;
  private resolvedValidationRules: ResolvedValidationRules = new Map();

  public constructor(
    private readonly validation: ValidationConfig = {},
  ) {}

  public prepare(schema: NormalizedSchema): void {
    this.resolvedValidationRules = new Map();
    this.resolvedValidationRules = resolveValidationRules(schema, this.validation);
  }

  public recordClassName(record: NormalizedRecord): string {
    if (record.phpClassName !== undefined) {
      return record.phpClassName;
    }

    const className = toClassName(record.qualifiedName);

    return className.endsWith("Data") ? className : `${className}Data`;
  }

  public structImports(record: NormalizedRecord): readonly string[] {
    const fields = record.fields.filter(isStructField);
    const imports: string[] = [...BASE_STRUCT_IMPORTS];

    if (fields.some((field) => toPropertyName(field.name) !== field.name)) {
      imports.push(MAP_PROPERTY_NAME);
    }

    if (fields.length > 0) {
      imports.push(RULES);
    }

    if (fields.some((field) => dataCollectionType(field.type) !== null)) {
      imports.push(DATA_COLLECTION, TYPED_DATA_COLLECTION);
    }

    return imports;
  }

  public enumImports(record: NormalizedRecord): readonly string[] {
    if (record.recordType !== "enum") {
      return [];
    }

    const needsTypedDataCollection = record.fields.some((field) => (
      field.kind === "field"
      && field.hasPayload
      && requiresTypedDataCollection(field.type)
    ));

    return needsTypedDataCollection ? [TYPED_DATA_COLLECTION] : [];
  }

  public rpcImports(methods: readonly NormalizedMethod[]): readonly string[] {
    const needsTypedDataCollection = methods.some((method) => (
      requiresTypedDataCollection(method.requestType)
      || requiresTypedDataCollection(method.responseType)
    ));

    return needsTypedDataCollection ? [TYPED_DATA_COLLECTION] : [];
  }

  public renderStruct({ record, context }: StructRenderRequest): GeneratedFile {
    if (record.recordType !== "struct") {
      throw new Error(`Cannot render non-struct record ${record.identity} as a struct.`);
    }

    const className = classNameForRecord(record, context);
    const imports = this.structImports(record);
    const denseJson = importClass(context.imports, DENSE_JSON);
    const fieldClass = importClass(context.imports, FIELD);
    const typeClass = importClass(context.imports, TYPE);
    const baseData = importClass(context.imports, BASE_DATA);
    const fields = record.fields.filter(isStructField);
    const constructor = this.renderConstructor(record, fields, context);
    const members = [
      constructor,
      this.renderSkirType(record, context, fieldClass, typeClass),
      this.renderMakeFromSkirPayload(fields, context),
      this.renderFromSkir(className, denseJson),
      this.renderToSkirArray(fields, context),
      this.renderToSkir(denseJson),
      this.renderToSkirJson(denseJson),
    ].filter((member): member is string => member !== null);
    const body = [
      `final class ${className} extends ${baseData}`,
      "{",
      ...members.flatMap((member, index) => index === 0
        ? [indent(member)]
        : ["", indent(member)]),
      "}",
    ].join("\n");

    return {
      path: outputPath(context, `${className}.php`),
      code: renderPhpFile({
        namespace: context.namespace,
        imports: renderUseStatements(context.imports, imports),
        body,
      }),
    };
  }

  public phpType(type: NormalizedType, context: RenderContext): string {
    if (type.kind === "bool") {
      return "bool";
    }

    if (type.kind === "int32" || type.kind === "timestamp") {
      return "int";
    }

    if (type.kind === "int64" || type.kind === "hash64") {
      return "int|string";
    }

    if (type.kind === "float32" || type.kind === "float64") {
      return "float";
    }

    if (type.kind === "string" || type.kind === "bytes") {
      return "string";
    }

    if (type.kind === "array") {
      return isDirectStructCollection(type)
        ? importClass(context.imports, TYPED_DATA_COLLECTION)
        : "array";
    }

    if (type.kind === "optional") {
      return nullablePhpType(this.phpType(type.inner, context));
    }

    if (type.kind === "record") {
      return recordTypeClassName(type, context);
    }

    return "mixed";
  }

  public toSkirExpression(
    type: NormalizedType,
    expression: string,
    context: RenderContext,
  ): string {
    return this.toSkirValueExpression(type, expression, context, true);
  }

  public fromSkirExpression(
    type: NormalizedType,
    expression: string,
    context: RenderContext,
  ): string {
    return valueFromTargetExpression(type, expression, context);
  }

  public clientResponseExpression(
    type: NormalizedType,
    expression: string,
    context: RenderContext,
  ): string {
    return valueFromTargetExpression(type, expression, context);
  }

  public enumPayloadToSkirExpression(
    type: NormalizedType,
    expression: string,
    context: RenderContext,
  ): string {
    return this.toSkirValueExpression(type, expression, context, true);
  }

  public enumPayloadFromSkirExpression(
    type: NormalizedType,
    expression: string,
    context: RenderContext,
  ): string {
    return valueFromTargetExpression(type, expression, context);
  }

  public manifestObjectClass(
    type: NormalizedType,
    context: RenderContext,
  ): string | null {
    if (type.kind !== "record") {
      return null;
    }

    const className = context.names.namesByIdentity.get(type.recordIdentity);

    if (className === undefined) {
      throw new Error(`No PHP class name was resolved for record ${type.recordIdentity}.`);
    }

    return canonicalRecordClassName(
      recordNamespace(type.recordIdentity, context.rootNamespace),
      className,
    );
  }

  private renderConstructor(
    record: NormalizedRecord,
    fields: readonly NormalizedField[],
    context: RenderContext,
  ): string | null {
    if (fields.length === 0) {
      return null;
    }

    const validationRules = this.resolvedValidationRules.get(record.identity) ?? new Map();

    return [
      "public function __construct(",
      ...fields.flatMap((field) => [
        ...propertyAttributes(
          field,
          context,
          validationRules.get(field.name) ?? [],
        ).map((attribute) => `    ${attribute}`),
        `    public readonly ${this.phpType(field.type, context)} $${toPropertyName(field.name)},`,
      ]),
      ") {}",
    ].join("\n");
  }

  private renderSkirType(
    record: NormalizedRecord,
    context: RenderContext,
    fieldClass: string,
    typeClass: string,
  ): string {
    const entries = record.fields.map((field) => {
      if (field.kind === "removed") {
        return `        ${fieldClass}::removed(${field.number}),`;
      }

      if (!field.hasPayload) {
        throw new Error(`Struct field ${field.name} in ${record.identity} has no payload type.`);
      }

      return `        ${fieldClass}::value(${phpSingleQuotedLiteral(field.name)}, ${field.number}, ${runtimeTypeExpression(field.type, context, this, typeClass)}),`;
    });

    if (entries.length === 0) {
      return [
        `public static function skirType(): ${typeClass}`,
        "{",
        `    return ${typeClass}::struct([]);`,
        "}",
      ].join("\n");
    }

    return [
      `public static function skirType(): ${typeClass}`,
      "{",
      `    return ${typeClass}::struct([`,
      entries.join("\n"),
      "    ]);",
      "}",
    ].join("\n");
  }

  private renderMakeFromSkirPayload(
    fields: readonly NormalizedField[],
    context: RenderContext,
  ): string {
    const payload = fields.length === 0
      ? ["    $payload = [];"]
      : [
        "    $payload = [",
        ...fields.map((field) => renderPayloadEntry(field, context)),
        "    ];",
      ];

    return [
      "/** @param array<string, mixed> $data */",
      "public static function makeFromSkirPayload(array $data): self",
      "{",
      "    self::validate($data);",
      "",
      ...payload,
      "",
      "    return self::from($payload);",
      "}",
    ].join("\n");
  }

  private renderFromSkir(className: string, denseJson: string): string {
    return [
      `public static function fromSkir(string $json): ${className}`,
      "{",
      `    $data = ${denseJson}::fromJson(self::skirType(), $json);`,
      "",
      "    return self::makeFromSkirPayload($data);",
      "}",
    ].join("\n");
  }

  private renderToSkirArray(
    fields: readonly NormalizedField[],
    context: RenderContext,
  ): string {
    if (fields.length === 0) {
      return [
        "/** @return array<string, mixed> */",
        "public function toSkirArray(): array",
        "{",
        "    return [];",
        "}",
      ].join("\n");
    }

    return [
      "/** @return array<string, mixed> */",
      "public function toSkirArray(): array",
      "{",
      "    return [",
      ...fields.map((field) => {
        const expression = this.toSkirExpression(
          field.type,
          `$this->${toPropertyName(field.name)}`,
          context,
        );

        return renderArrayEntry(field.name, expression, 8);
      }),
      "    ];",
      "}",
    ].join("\n");
  }

  private renderToSkir(denseJson: string): string {
    return [
      "/** @return array<int, mixed> */",
      "public function toSkir(): array",
      "{",
      `    return ${denseJson}::encode(self::skirType(), $this->toSkirArray());`,
      "}",
    ].join("\n");
  }

  private renderToSkirJson(denseJson: string): string {
    return [
      "public function toSkirJson(): string",
      "{",
      `    return ${denseJson}::toJson(self::skirType(), $this->toSkirArray());`,
      "}",
    ].join("\n");
  }

  private toSkirValueExpression(
    type: NormalizedType,
    expression: string,
    context: RenderContext,
    allowTypedCollection: boolean,
  ): string {
    if (type.kind === "record") {
      return type.recordType === "enum"
        ? `${expression}->toSkirValue()`
        : `${expression}->toSkirArray()`;
    }

    if (type.kind === "optional") {
      if (isRecursivelyMappedType(type.inner)) {
        return `${expression} === null ? null : ${this.toSkirValueExpression(type.inner, expression, context, allowTypedCollection)}`;
      }

      return expression;
    }

    if (type.kind === "array" && isRecursivelyMappedType(type.item)) {
      const source = allowTypedCollection && isDirectStructCollection(type)
        ? `${expression}->all()`
        : expression;
      const itemExpression = this.toSkirValueExpression(type.item, "$item", context, false);

      return renderArrayMap(itemExpression, source, "mixed", "mixed");
    }

    return expression;
  }
}

function propertyAttributes(
  field: NormalizedField,
  context: RenderContext,
  customRules: readonly string[],
): readonly string[] {
  const attributes: string[] = [];
  const propertyName = toPropertyName(field.name);

  if (propertyName !== field.name) {
    const mapPropertyName = importClass(context.imports, MAP_PROPERTY_NAME);

    attributes.push(`#[${mapPropertyName}(${phpSingleQuotedLiteral(field.name)})]`);
  }

  const rules = importClass(context.imports, RULES);
  const combinedRules = [...structuralRules(field.type), ...customRules];

  attributes.push(`#[${rules}([${combinedRules.map(phpSingleQuotedLiteral).join(", ")}])]`);

  const collectionType = dataCollectionType(field.type);

  if (collectionType !== null) {
    const dataCollection = importClass(context.imports, DATA_COLLECTION);

    attributes.push(`#[${dataCollection}(${recordTypeClassName(collectionType, context)}::class)]`);
  }

  return attributes;
}

function renderPayloadEntry(field: NormalizedField, context: RenderContext): string {
  const fieldLiteral = phpSingleQuotedLiteral(field.name);
  const directExpression = `$data[${fieldLiteral}]`;
  const expression = valueFromSkirPayloadExpression(
    field.type,
    field.type.kind === "optional"
      ? `${directExpression} ?? null`
      : directExpression,
    context,
  );

  return renderArrayEntry(field.name, expression, 8);
}

function renderArrayEntry(fieldName: string, expression: string, indentation: number): string {
  const padding = " ".repeat(indentation);
  const continuedExpression = expression.replaceAll("\n", `\n${padding}`);

  return `${padding}${phpSingleQuotedLiteral(fieldName)} => ${continuedExpression},`;
}

function valueFromSkirPayloadExpression(
  type: NormalizedType,
  expression: string,
  context: RenderContext,
): string {
  if (type.kind === "record") {
    const className = recordTypeClassName(type, context);

    return type.recordType === "enum"
      ? `${className}::fromSkirValue(${expression})`
      : `${className}::makeFromSkirPayload(${expression})`;
  }

  if (type.kind === "optional") {
    if (isRecursivelyMappedType(type.inner)) {
      return `(${expression}) === null ? null : ${valueFromSkirPayloadExpression(type.inner, expression, context)}`;
    }

    return expression;
  }

  if (type.kind === "array" && isRecursivelyMappedType(type.item)) {
    const itemExpression = valueFromSkirPayloadExpression(type.item, "$item", context);
    const [inputType, returnType] = hydrationArrowTypes(type.item, context);

    return renderArrayMap(itemExpression, expression, inputType, returnType);
  }

  return expression;
}

function valueFromTargetExpression(
  type: NormalizedType,
  expression: string,
  context: RenderContext,
): string {
  if (isDirectStructCollection(type)) {
    const typedDataCollection = importClass(context.imports, TYPED_DATA_COLLECTION);
    const collectionClass = recordTypeClassName(type.item, context);
    const hydratedItems = valueFromSkirPayloadExpression(type, expression, context);

    return `${typedDataCollection}::of(${collectionClass}::class, ${hydratedItems})`;
  }

  if (type.kind === "optional") {
    return `${expression} === null ? null : ${valueFromTargetExpression(type.inner, expression, context)}`;
  }

  return valueFromSkirPayloadExpression(type, expression, context);
}

function hydrationArrowTypes(
  type: NormalizedType,
  context: RenderContext,
): readonly [string, string] {
  if (type.kind === "record" && type.recordType === "struct") {
    return ["array", recordTypeClassName(type, context)];
  }

  if (type.kind === "array") {
    return ["array", "array"];
  }

  return ["mixed", "mixed"];
}

function renderArrayMap(
  itemExpression: string,
  sourceExpression: string,
  inputType: string,
  returnType: string,
): string {
  const continuedItemExpression = itemExpression.replaceAll("\n", "\n    ");
  const continuedSourceExpression = sourceExpression.replaceAll("\n", "\n    ");

  return [
    "array_map(",
    `    static fn (${inputType} $item): ${returnType} => ${continuedItemExpression},`,
    `    ${continuedSourceExpression},`,
    ")",
  ].join("\n");
}

function dataCollectionType(
  type: NormalizedType,
): Extract<NormalizedType, { readonly kind: "record" }> | null {
  const unwrappedType = unwrapOptionalType(type);

  if (!isDirectStructCollection(unwrappedType)) {
    return null;
  }

  return unwrappedType.item;
}

function isDirectStructCollection(
  type: NormalizedType,
): type is Extract<NormalizedType, { readonly kind: "array" }> & {
  readonly item: Extract<NormalizedType, { readonly kind: "record" }>;
} {
  return type.kind === "array"
    && type.item.kind === "record"
    && type.item.recordType === "struct";
}

function requiresTypedDataCollection(type: NormalizedType): boolean {
  if (type.kind === "optional") {
    return requiresTypedDataCollection(type.inner);
  }

  return isDirectStructCollection(type);
}

function phpSingleQuotedLiteral(value: string): string {
  const expressions: string[] = [];
  let segment = "";

  for (const character of value) {
    if (character !== "\n" && character !== "\r") {
      segment += character;
      continue;
    }

    if (segment !== "") {
      expressions.push(escapedPhpStringSegment(segment));
      segment = "";
    }

    expressions.push(character === "\n" ? '"\\n"' : '"\\r"');
  }

  if (segment !== "" || expressions.length === 0) {
    expressions.push(escapedPhpStringSegment(segment));
  }

  return expressions.join(".");
}

function escapedPhpStringSegment(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function nullablePhpType(type: string): string {
  const unionMembers = type.split("|");

  if (type === "mixed" || type.startsWith("?") || unionMembers.includes("null")) {
    return type;
  }

  return unionMembers.length === 1 ? `?${type}` : `${type}|null`;
}

function unwrapOptionalType(type: NormalizedType): NormalizedType {
  let unwrappedType = type;

  while (unwrappedType.kind === "optional") {
    unwrappedType = unwrappedType.inner;
  }

  return unwrappedType;
}

function isRecursivelyMappedType(type: NormalizedType): boolean {
  return type.kind === "record" || type.kind === "optional" || type.kind === "array";
}

function isStructField(
  field: NormalizedRecord["fields"][number],
): field is NormalizedField {
  return field.kind === "field" && field.hasPayload;
}

function runtimeTypeExpression(
  type: NormalizedType,
  context: RenderContext,
  adapter: SimpleDataObjectsTarget,
  typeClass: string,
): string {
  if (type.kind === "array") {
    return `${typeClass}::array(${runtimeTypeExpression(type.item, context, adapter, typeClass)})`;
  }

  if (type.kind === "optional") {
    return `${typeClass}::optional(${runtimeTypeExpression(type.inner, context, adapter, typeClass)})`;
  }

  if (type.kind === "record") {
    return `${adapter.phpType(type, context)}::skirType()`;
  }

  return `${typeClass}::${type.kind}()`;
}

function classNameForRecord(record: NormalizedRecord, context: RenderContext): string {
  const className = context.names.namesByIdentity.get(record.identity);

  if (className === undefined) {
    throw new Error(`No PHP class name was resolved for struct ${record.identity}.`);
  }

  return className;
}

function recordTypeClassName(
  type: Extract<NormalizedType, { readonly kind: "record" }>,
  context: RenderContext,
): string {
  const className = context.names.namesByIdentity.get(type.recordIdentity);

  if (className === undefined) {
    throw new Error(`No PHP class name was resolved for record ${type.recordIdentity}.`);
  }

  const namespace = recordNamespace(type.recordIdentity, context.rootNamespace);

  if (namespace === context.namespace) {
    return className;
  }

  const fullyQualifiedClassName = canonicalRecordClassName(namespace, className);
  const isReserved = [...context.imports.reservedNames].some((reservedName) => (
    reservedName.toLowerCase() === className.toLowerCase()
  ));

  if (isReserved) {
    return `\\${fullyQualifiedClassName}`;
  }

  const existingImport = [...context.imports.imports.entries()]
    .find(([localName]) => localName.toLowerCase() === className.toLowerCase());

  if (existingImport === undefined) {
    return importClassAs(context.imports, fullyQualifiedClassName, className);
  }

  return existingImport[1].toLowerCase() === fullyQualifiedClassName.toLowerCase()
    ? existingImport[0]
    : `\\${fullyQualifiedClassName}`;
}

function canonicalRecordClassName(namespace: string, className: string): string {
  const fullyQualifiedClassName = `${namespace}\\${className}`.replace(/^\\+/u, "");
  const parts = fullyQualifiedClassName.split("\\");

  if (parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(part))) {
    throw new Error(`Invalid normalized PHP record class name ${fullyQualifiedClassName}.`);
  }

  if (parts.at(-1) !== className) {
    throw new Error(`Invalid normalized PHP record basename ${className}.`);
  }

  return fullyQualifiedClassName;
}

function recordNamespace(recordIdentity: string, rootNamespace: string): string {
  const separatorIndex = recordIdentity.lastIndexOf("::");

  if (separatorIndex === -1) {
    throw new Error(`Invalid normalized record identity ${recordIdentity}.`);
  }

  const modulePath = recordIdentity.slice(0, separatorIndex);
  const namespaceSegments = modulePath
    .split("/")
    .slice(0, -1)
    .map((segment) => toPhpNamespaceSegment(segment))
    .filter((segment) => segment !== "");

  return [rootNamespace, ...namespaceSegments]
    .filter((segment) => segment !== "")
    .join("\\");
}

function outputPath(context: RenderContext, fileName: string): string {
  return context.pathPrefix === "" ? fileName : `${context.pathPrefix}/${fileName}`;
}
