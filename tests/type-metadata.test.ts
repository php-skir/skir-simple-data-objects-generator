import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { generateSimpleDataObjectsFiles, type PhpGeneratorInput } from "../src/generator.js";

const TRICKY_DOC = "It's a \"quote\", a back\\slash\nand a second line.";
const TRICKY_DOC_PHP = "'It\\'s a \"quote\", a back\\\\slash'.\"\\n\".'and a second line.'";
const temporaryDirectories: string[] = [];

type InputRecord = Extract<
  NonNullable<PhpGeneratorInput["modules"][number]["records"]>[number],
  { readonly name: unknown }
>;

const session: InputRecord = {
  kind: "record",
  key: "session-key",
  name: "Session",
  recordType: "struct",
  doc: { text: "What a client stores after signing in." },
  fields: [
    { kind: "field", name: "token", number: 0, type: "string" },
    {
      kind: "field",
      name: "user",
      number: 1,
      type: { kind: "record", key: "invitation-key", recordType: "struct" },
      doc: { text: "The signed-in user." },
    },
    { kind: "field", name: "note", number: 2, type: "string", doc: { text: TRICKY_DOC } },
    { kind: "field", name: "blank_doc", number: 3, type: "string", doc: { text: " \n " } },
  ],
};
const invitation: InputRecord = {
  kind: "record",
  key: "invitation-key",
  name: "Invitation",
  recordType: "struct",
  fields: [{ kind: "field", name: "email", number: 0, type: "string" }],
};
const status: InputRecord = {
  kind: "record",
  key: "status-key",
  name: "Status",
  recordType: "enum",
  fields: [
    { kind: "field", name: "pending", number: 1 },
    { kind: "field", name: "declined", number: 2, type: "string", doc: { text: "Carries the reason." } },
  ],
};
const details: InputRecord = {
  kind: "record",
  key: "details-key",
  name: "Details",
  recordType: "struct",
  doc: { text: "Extra details." },
  fields: [],
};
const client: InputRecord = {
  kind: "record",
  key: "client-key",
  name: "Client",
  recordType: "enum",
  fields: [
    { kind: "field", name: "tablet", number: 1 },
    { kind: "field", name: "mobile", number: 2, doc: { text: "The phone app." } },
  ],
};
const blank: InputRecord = {
  kind: "record",
  key: "blank-key",
  name: "Blank",
  recordType: "struct",
  fields: [],
};

function nestedInInvitation(record: InputRecord) {
  return {
    kind: "record-location" as const,
    record,
    recordAncestors: [invitation, record],
    modulePath: "identity/identity.skir",
  };
}

const input: PhpGeneratorInput = {
  modules: [{
    path: "identity/identity.skir",
    records: [
      session,
      invitation,
      nestedInInvitation(status),
      nestedInInvitation(details),
      client,
      blank,
    ],
    methods: [
      {
        kind: "method",
        name: "GetMe",
        number: 3620019547,
        requestType: { kind: "record", key: "blank-key", recordType: "struct" },
        responseType: { kind: "record", key: "session-key", recordType: "struct" },
        doc: { text: "Returns the signed-in user." },
      },
      { kind: "method", name: "Ping", number: 7, requestType: "string", responseType: "string" },
    ],
  }],
};

/** Collapses indentation and line breaks so assertions only pin the emitted tokens. */
function compact(code: string): string {
  return code.replace(/\s*\n\s*/g, " ");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("type names and docs in generated runtime descriptors", () => {
  const files = generateSimpleDataObjectsFiles(input);
  const codeFor = (path: string): string => {
    const file = files.find((candidate) => candidate.path === path);

    if (file === undefined) {
      throw new Error(`No generated file ${path}; got ${files.map((candidate) => candidate.path).join(", ")}.`);
    }

    return compact(file.code);
  };

  it("renders the record id and docs on a top-level struct and its fields", () => {
    expect(codeFor("Identity/SessionData.php")).toContain([
      "return Type::struct([",
      "Field::value('token', 0, Type::string()),",
      "Field::value('user', 1, InvitationData::skirType(), doc: 'The signed-in user.'),",
      `Field::value('note', 2, Type::string(), doc: ${TRICKY_DOC_PHP}),`,
      "Field::value('blank_doc', 3, Type::string()),",
      "], recordId: 'identity/identity.skir:Session', doc: 'What a client stores after signing in.');",
    ].join(" "));
  });

  it("omits the doc argument when a struct and its fields have no doc comment", () => {
    const code = codeFor("Identity/InvitationData.php");

    expect(code).toContain([
      "return Type::struct([",
      "Field::value('email', 0, Type::string()),",
      "], recordId: 'identity/identity.skir:Invitation');",
    ].join(" "));
    expect(code).not.toContain("doc:");
  });

  it("renders dotted record ids for nested records", () => {
    expect(codeFor("Identity/InvitationStatusData.php")).toContain([
      "return Type::enum([",
      "Variant::constant('pending', 1),",
      "Variant::wrapper('declined', 2, Type::string(), doc: 'Carries the reason.'),",
      "], recordId: 'identity/identity.skir:Invitation.Status');",
    ].join(" "));
  });

  it("renders the record id and variant docs on an enum", () => {
    expect(codeFor("Identity/ClientData.php")).toContain([
      "return Type::enum([",
      "Variant::constant('tablet', 1),",
      "Variant::constant('mobile', 2, doc: 'The phone app.'),",
      "], recordId: 'identity/identity.skir:Client');",
    ].join(" "));
  });

  it("renders the record id and doc on empty structs", () => {
    expect(codeFor("Identity/InvitationDetailsData.php")).toMatch(
      /return Type::struct\(\[\s*\], recordId: 'identity\/identity\.skir:Invitation\.Details', doc: 'Extra details\.'\);/,
    );
    expect(codeFor("Identity/BlankData.php")).toMatch(
      /return Type::struct\(\[\s*\], recordId: 'identity\/identity\.skir:Blank'\);/,
    );
  });

  it("renders method docs only on documented methods", () => {
    const code = codeFor("Identity/SkirMethods.php");

    expect(code).toContain([
      "return new MethodDescriptor(",
      "name: 'GetMe',",
      "number: 3620019547,",
      "requestType: BlankData::skirType(),",
      "responseType: SessionData::skirType(),",
      "doc: 'Returns the signed-in user.',",
      ");",
    ].join(" "));
    expect(code).toContain([
      "name: 'Ping',",
      "number: 7,",
      "requestType: Type::string(),",
      "responseType: Type::string(),",
      ");",
    ].join(" "));
    expect(code.match(/doc:/g)).toHaveLength(1);
  });

  it("emits docs with quotes, backslashes, and line breaks as valid PHP", () => {
    const directory = mkdtempSync(join(tmpdir(), "skir-type-metadata-"));
    temporaryDirectories.push(directory);

    for (const [index, file] of files.filter((candidate) => candidate.path.endsWith(".php")).entries()) {
      const lintFile = join(directory, `${index}.php`);

      writeFileSync(lintFile, file.code);
      expect(() => execFileSync("php", ["-l", lintFile], { stdio: "pipe", timeout: 10_000 })).not.toThrow();
    }

    expect(execFileSync("php", ["-r", `echo ${TRICKY_DOC_PHP};`], { encoding: "utf8" })).toBe(TRICKY_DOC);
  });
});
