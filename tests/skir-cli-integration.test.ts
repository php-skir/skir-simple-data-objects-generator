import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const EXTERNAL_COMMAND_TIMEOUT_MS = 120_000;
const EXTERNAL_COMMAND_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const temporaryPaths: string[] = [];

afterEach(() => {
  for (const temporaryPath of temporaryPaths.splice(0)) {
    rmSync(temporaryPath, { recursive: true, force: true });
  }
});

describe("skir CLI integration", () => {
  it("generates executable SDO PHP and an exact manifest from imported real .skir files", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "skir-sdo-generator-cli-"));
    temporaryPaths.push(projectPath);
    const skirSourcePath = join(projectPath, "skir-src");
    const adminSourcePath = join(skirSourcePath, "admin");
    const commonSourcePath = join(skirSourcePath, "common");
    const stubClientPath = join(projectPath, "stub-client", "Skir", "Client");
    const generatedPath = join(projectPath, "generated", "skirout");
    const composerHome = mkdtempSync(join(tmpdir(), "skir-sdo-generator-composer-"));
    temporaryPaths.push(composerHome);
    const runtimePath = process.env.SKIR_RUNTIME_PATH ?? resolve("../runtime");
    const generatorPath = resolve("dist/index.js");
    const skirBinPath = resolve("node_modules/skir/dist/compiler.js");

    expect(existsSync(generatorPath)).toBe(true);
    expect(existsSync(skirBinPath)).toBe(true);

    rmSync(skirSourcePath, { recursive: true, force: true });
    rmSync(generatedPath, { recursive: true, force: true });
    mkdirSync(adminSourcePath, { recursive: true });
    mkdirSync(commonSourcePath, { recursive: true });
    mkdirSync(stubClientPath, { recursive: true });

    writeFileSync(join(projectPath, "skir.yml"), [
      "generators:",
      `  - mod: ${pathToFileURL(generatorPath).href}`,
      "    outDir: generated/skirout",
      "    config:",
      '      namespace: "Skir"',
      "",
    ].join("\n"));

    writeFileSync(join(adminSourcePath, "users.skir"), [
      'import { Address } from "../common/address.skir";',
      "",
      "/// A registered user.",
      "/// It's \"quoted\" with a back\\slash.",
      "struct User {",
      "  user_id: int32;",
      "  /// The user's display name.",
      "  name: string;",
      "  address: Address;",
      "  previous_addresses: [Address];",
      "  optional_addresses: [Address]?;",
      "  nested_addresses: [[Address]];",
      "  nickname: string?;",
      "  subscription_status: SubscriptionStatus;",
      "",
      "  /// Per-user settings.",
      "  struct Preferences {}",
      "",
      "  enum Role {",
      "    admin;",
      "    /// Read-only access.",
      "    viewer;",
      "  }",
      "}",
      "",
      "enum SubscriptionStatus {",
      "  free;",
      "  /// When the premium plan started.",
      "  premium_since: timestamp;",
      "}",
      "",
      "/// Returns the user.",
      "method GetUser(User): User = 3180856469;",
      "",
    ].join("\n"));

    writeFileSync(join(commonSourcePath, "address.skir"), [
      "struct Address {",
      "  city: string;",
      "  postal_codes: [string];",
      "}",
      "",
    ].join("\n"));

    writeFileSync(join(projectPath, "composer.json"), JSON.stringify({
      repositories: [{
        type: "path",
        url: runtimePath,
        options: { symlink: false },
      }],
      require: {
        php: "^8.4",
        "php-skir/runtime": "*",
        "std-out/simple-data-objects": "^2.8",
      },
      autoload: {
        "psr-4": {
          "Skir\\Client\\": "stub-client/Skir/Client/",
        },
      },
      config: { "sort-packages": true },
      "minimum-stability": "dev",
      "prefer-stable": true,
    }, null, 2));

    writeFileSync(join(stubClientPath, "SkirClient.php"), `<?php

declare(strict_types=1);

namespace Skir\\Client;

use Skir\\Runtime\\MethodDescriptor;

final class SkirClient
{
    public function invoke(MethodDescriptor $descriptor, mixed $request): mixed
    {
        if ($descriptor->name !== 'GetUser' || ! is_array($request)) {
            throw new \\RuntimeException('Unexpected RPC request.');
        }

        return $request;
    }
}
`);

    writeFileSync(join(projectPath, "verify.php"), `<?php

declare(strict_types=1);

require __DIR__.'/vendor/autoload.php';

use Illuminate\\Translation\\ArrayLoader;
use Illuminate\\Translation\\Translator;
use Illuminate\\Validation\\Factory as ValidatorFactory;
use Skir\\Admin\\SkirMethods;
use Skir\\Admin\\SkirRpcClient;
use Skir\\Admin\\SubscriptionStatusData;
use Skir\\Admin\\UserData;
use Skir\\Client\\SkirClient as TransportSkirClient;
use Skir\\Common\\AddressData;
use StdOut\\SimpleDataObjects\\BaseData;
use StdOut\\SimpleDataObjects\\TypedDataCollection;

BaseData::setValidatorFactory(new ValidatorFactory(new Translator(new ArrayLoader(), 'en')));

$addresses = TypedDataCollection::of(AddressData::class, [
    new AddressData(city: 'Brussels', postalCodes: ['1000']),
]);
$user = new UserData(
    userId: 400,
    name: 'John Doe',
    address: new AddressData(city: 'Antwerp', postalCodes: ['2000', '2018']),
    previousAddresses: $addresses,
    optionalAddresses: null,
    nestedAddresses: [[new AddressData(city: 'Ghent', postalCodes: ['9000'])]],
    nickname: null,
    subscriptionStatus: SubscriptionStatusData::premiumSince(1743682787000),
);

$decoded = UserData::fromSkir($user->toSkirJson());

if (! $decoded->previousAddresses instanceof TypedDataCollection || $decoded->previousAddresses->all()[0]->city !== 'Brussels') {
    throw new RuntimeException('Imported struct collection did not round trip.');
}

if ($decoded->optionalAddresses !== null) {
    throw new RuntimeException('Null optional collection did not round trip.');
}

if ($decoded->nickname !== null) {
    throw new RuntimeException('Null optional primitive did not round trip.');
}

if ($decoded->nestedAddresses[0][0]->city !== 'Ghent') {
    throw new RuntimeException('Nested collection did not round trip.');
}

if ($decoded->subscriptionStatus->name() !== 'premium_since') {
    throw new RuntimeException('Enum value did not round trip.');
}

$method = SkirMethods::getUser();

if ($method->name !== 'GetUser' || $method->number !== 3180856469) {
    throw new RuntimeException('Unexpected method descriptor.');
}

$memberDoc = static function (array $members, string $name): ?string {
    foreach ($members as $member) {
        if ($member->name === $name) {
            return $member->doc;
        }
    }

    throw new RuntimeException('No descriptor member named '.$name.'.');
};
$userType = \\Skir\\Admin\\UserData::skirType();
$preferencesType = \\Skir\\Admin\\UserPreferencesData::skirType();
$roleType = \\Skir\\Admin\\UserRoleData::skirType();
$statusType = \\Skir\\Admin\\SubscriptionStatusData::skirType();
$metadata = [
    'struct record id' => [$userType->recordId, 'admin/users.skir:User'],
    'struct doc' => [$userType->doc, "A registered user.\\nIt's \\"quoted\\" with a back\\\\slash."],
    'field doc' => [$memberDoc($userType->fields, 'name'), "The user's display name."],
    'undocumented field doc' => [$memberDoc($userType->fields, 'user_id'), null],
    'nested empty struct record id' => [$preferencesType->recordId, 'admin/users.skir:User.Preferences'],
    'nested empty struct doc' => [$preferencesType->doc, 'Per-user settings.'],
    'nested enum record id' => [$roleType->recordId, 'admin/users.skir:User.Role'],
    'undocumented enum doc' => [$roleType->doc, null],
    'constant variant doc' => [$memberDoc($roleType->variants, 'viewer'), 'Read-only access.'],
    'undocumented variant doc' => [$memberDoc($roleType->variants, 'admin'), null],
    'enum record id' => [$statusType->recordId, 'admin/users.skir:SubscriptionStatus'],
    'wrapper variant doc' => [$memberDoc($statusType->variants, 'premium_since'), 'When the premium plan started.'],
    'imported struct record id' => [\\Skir\\Common\\AddressData::skirType()->recordId, 'common/address.skir:Address'],
    'method doc' => [$method->doc, 'Returns the user.'],
];

foreach ($metadata as $label => [$actual, $expected]) {
    if ($actual !== $expected) {
        throw new RuntimeException('Unexpected '.$label.': '.var_export($actual, true));
    }
}

$rpcUser = (new SkirRpcClient(new TransportSkirClient()))->getUser($user);

if (! $rpcUser instanceof UserData || ! $rpcUser->previousAddresses instanceof TypedDataCollection) {
    throw new RuntimeException('Generated client response did not hydrate SDO values.');
}
`);

    execFileSync("node", [skirBinPath, "gen", "--root", projectPath], {
      cwd: resolve("."),
      maxBuffer: EXTERNAL_COMMAND_MAX_BUFFER_BYTES,
      stdio: "pipe",
      timeout: EXTERNAL_COMMAND_TIMEOUT_MS,
    });

    execFileSync("node", [
      resolve("dist/cli.js"),
      "configure-composer",
      "--root",
      projectPath,
      "--mod",
      pathToFileURL(generatorPath).href,
    ], {
      cwd: resolve("."),
      maxBuffer: EXTERNAL_COMMAND_MAX_BUFFER_BYTES,
      stdio: "pipe",
      timeout: EXTERNAL_COMMAND_TIMEOUT_MS,
    });

    expect(JSON.parse(readFileSync(join(projectPath, "composer.json"), "utf8")))
      .toMatchObject({
        autoload: {
          "psr-4": {
            "Skir\\": "generated/skirout/",
          },
        },
      });

    const generatedFiles = [
      "Admin/AbstractSkirProcedures.php",
      "Admin/AdminSkirMethod.php",
      "Admin/SkirMethods.php",
      "Admin/SkirProcedureProvider.php",
      "Admin/SkirProcedures.php",
      "Admin/SkirRpcClient.php",
      "Admin/SubscriptionStatusData.php",
      "Admin/UserData.php",
      "Common/AddressData.php",
    ];

    for (const generatedFile of generatedFiles) {
      const filePath = join(generatedPath, generatedFile);

      expect(existsSync(filePath)).toBe(true);
      execFileSync("php", ["-l", filePath], {
        maxBuffer: EXTERNAL_COMMAND_MAX_BUFFER_BYTES,
        stdio: "pipe",
        timeout: EXTERNAL_COMMAND_TIMEOUT_MS,
      });
    }

    const userCode = readFileSync(join(generatedPath, "Admin", "UserData.php"), "utf8");
    const clientCode = readFileSync(join(generatedPath, "Admin", "SkirRpcClient.php"), "utf8");
    const preferencesCode = readFileSync(join(generatedPath, "Admin", "UserPreferencesData.php"), "utf8");
    const roleCode = readFileSync(join(generatedPath, "Admin", "UserRoleData.php"), "utf8");
    const methodDescriptorsCode = readFileSync(join(generatedPath, "Admin", "SkirMethods.php"), "utf8");

    expect(userCode).toContain(
      "], recordId: 'admin/users.skir:User', doc: 'A registered user.'.\"\\n\".'It\\'s \"quoted\" with a back\\\\slash.');",
    );
    expect(userCode).toContain("Field::value('user_id', 0, Type::int32()),");
    expect(userCode).toContain("Field::value('name', 1, Type::string(), doc: 'The user\\'s display name.'),");
    expect(preferencesCode).toMatch(
      /Type::struct\(\[\s*\], recordId: 'admin\/users\.skir:User\.Preferences', doc: 'Per-user settings\.'\);/,
    );
    expect(roleCode).toContain("Variant::constant('admin', 1),");
    expect(roleCode).toContain("Variant::constant('viewer', 2, doc: 'Read-only access.'),");
    expect(roleCode).toContain("], recordId: 'admin/users.skir:User.Role');");
    expect(methodDescriptorsCode).toContain("doc: 'Returns the user.',");

    expect(userCode).toContain("use Skir\\Common\\AddressData;");
    expect(userCode).toContain("public readonly TypedDataCollection $previousAddresses");
    expect(userCode).toContain("public readonly ?TypedDataCollection $optionalAddresses");
    expect(userCode).toContain("public readonly array $nestedAddresses");
    expect(clientCode).toContain("public function getUser(UserData $request): UserData");

    expect(JSON.parse(readFileSync(join(generatedPath, "skir-server-manifest.json"), "utf8")))
      .toEqual({
        version: 1,
        generator: "skir-simple-data-objects-generator",
        modules: [{
          name: "Admin",
          methodEnum: "Skir\\Admin\\AdminSkirMethod",
          methods: [{
            name: "GetUser",
            enumCase: "GetUser",
            phpMethod: "getUser",
            requestType: "Skir\\Admin\\UserData",
            requestClass: "Skir\\Admin\\UserData",
            responseType: "Skir\\Admin\\UserData",
            responseClass: "Skir\\Admin\\UserData",
          }],
        }],
      });

    try {
      execFileSync("composer", [
        "install",
        "--no-interaction",
        "--no-plugins",
        "--no-progress",
        "--no-scripts",
        "--prefer-dist",
      ], {
        cwd: projectPath,
        env: {
          ...process.env,
          COMPOSER_CACHE_DIR: join(composerHome, "cache"),
          COMPOSER_HOME: composerHome,
          COMPOSER_NO_INTERACTION: "1",
        },
        maxBuffer: EXTERNAL_COMMAND_MAX_BUFFER_BYTES,
        stdio: "pipe",
        timeout: EXTERNAL_COMMAND_TIMEOUT_MS,
      });
    } finally {
      rmSync(composerHome, { recursive: true, force: true });
      temporaryPaths.splice(temporaryPaths.indexOf(composerHome), 1);
    }

    execFileSync("php", ["verify.php"], {
      cwd: projectPath,
      maxBuffer: EXTERNAL_COMMAND_MAX_BUFFER_BYTES,
      stdio: "inherit",
      timeout: EXTERNAL_COMMAND_TIMEOUT_MS,
    });
  }, 180_000);
  it("generates server and client-only output from two Skir roots sharing one skir-src", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "skir-sdo-generator-emit-"));
    temporaryPaths.push(projectPath);
    const composerHome = mkdtempSync(join(tmpdir(), "skir-sdo-generator-composer-"));
    temporaryPaths.push(composerHome);
    const runtimePath = process.env.SKIR_RUNTIME_PATH ?? resolve("../runtime");
    const generatorModule = pathToFileURL(resolve("dist/index.js")).href;
    const skirBinPath = resolve("node_modules/skir/dist/compiler.js");
    const clientRootPath = join(projectPath, "skir", "internal-client");
    const packagePath = join(projectPath, "packages", "internal-client");
    const serverOutPath = join(projectPath, "skir", "php-internal", "skirout");
    const clientOutPath = join(packagePath, "skirout");

    mkdirSync(join(projectPath, "skir-src", "people"), { recursive: true });
    mkdirSync(clientRootPath, { recursive: true });
    mkdirSync(join(packagePath, "stub-client", "Skir", "Client"), { recursive: true });
    symlinkSync(join("..", "..", "skir-src"), join(clientRootPath, "skir-src"));

    writeFileSync(join(projectPath, "skir-src", "people", "person.skir"), [
      "struct Person {",
      "  name: string;",
      "}",
      "",
      "method GetPerson(Person): Person = 1001;",
      "",
    ].join("\n"));
    writeFileSync(join(projectPath, "skir.yml"), [
      "generators:",
      `  - mod: ${generatorModule}`,
      "    outDir: ./skir/php-internal/skirout",
      "    config:",
      "      namespace: Skir",
      "      emit: server",
      "      validation:",
      "        people/person.skir:",
      "          Person:",
      "            name: [person_name]",
      "",
    ].join("\n"));
    writeFileSync(join(clientRootPath, "skir.yml"), [
      "generators:",
      `  - mod: ${generatorModule}`,
      "    outDir: ../../packages/internal-client/skirout",
      "    config:",
      "      namespace: Trackr\\InternalClient",
      "      emit: client",
      "",
    ].join("\n"));

    for (const root of [projectPath, clientRootPath]) {
      execFileSync("node", [skirBinPath, "gen", "--root", root], {
        maxBuffer: EXTERNAL_COMMAND_MAX_BUFFER_BYTES,
        stdio: "pipe",
        timeout: EXTERNAL_COMMAND_TIMEOUT_MS,
      });
    }

    const listFiles = (path: string): string[] => readdirSync(path, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(path.length + 1))
      .sort();

    expect(listFiles(serverOutPath)).toEqual([
      "People/AbstractSkirProcedures.php",
      "People/PeopleSkirMethod.php",
      "People/PersonData.php",
      "People/SkirMethods.php",
      "People/SkirProcedureProvider.php",
      "People/SkirProcedures.php",
      "skir-server-manifest.json",
    ]);
    expect(listFiles(clientOutPath)).toEqual([
      "People/PersonData.php",
      "People/SkirMethods.php",
      "People/SkirRpcClient.php",
    ]);
    expect(readFileSync(join(serverOutPath, "People", "PersonData.php"), "utf8")).toContain("'person_name'");

    for (const file of listFiles(clientOutPath)) {
      const code = readFileSync(join(clientOutPath, file), "utf8");

      expect(code).toContain("namespace Trackr\\InternalClient\\People;");
      expect(code).not.toContain("Skir\\Server\\");
      expect(code).not.toContain("person_name");
    }

    writeFileSync(join(packagePath, "composer.json"), JSON.stringify({
      name: "trackr/internal-client",
      repositories: [{
        type: "path",
        url: runtimePath,
        options: { symlink: false },
      }],
      require: {
        php: "^8.4",
        "php-skir/runtime": "*",
        "std-out/simple-data-objects": "^2.8",
      },
      autoload: {
        "psr-4": {
          "Skir\\Client\\": "stub-client/Skir/Client/",
          "Trackr\\InternalClient\\": "skirout/",
        },
      },
      "minimum-stability": "dev",
      "prefer-stable": true,
    }, null, 2));
    writeFileSync(join(packagePath, "stub-client", "Skir", "Client", "SkirClient.php"), `<?php

declare(strict_types=1);

namespace Skir\\Client;

use Skir\\Runtime\\MethodDescriptor;

final class SkirClient
{
    public function invoke(MethodDescriptor $descriptor, mixed $request): mixed
    {
        return $request;
    }
}
`);
    writeFileSync(join(packagePath, "verify.php"), `<?php

declare(strict_types=1);

require __DIR__.'/vendor/autoload.php';

use Illuminate\\Translation\\ArrayLoader;
use Illuminate\\Translation\\Translator;
use Illuminate\\Validation\\Factory as ValidatorFactory;
use Skir\\Client\\SkirClient;
use StdOut\\SimpleDataObjects\\BaseData;
use Trackr\\InternalClient\\People\\PersonData;
use Trackr\\InternalClient\\People\\SkirRpcClient;

BaseData::setValidatorFactory(new ValidatorFactory(new Translator(new ArrayLoader(), 'en')));

$person = (new SkirRpcClient(new SkirClient()))->getPerson(new PersonData(name: 'Ada'));

if ($person->name !== 'Ada') {
    throw new RuntimeException('Client-only response did not hydrate.');
}

if (interface_exists('Skir\\Server\\Contracts\\SkirMethodReference')) {
    throw new RuntimeException('php-skir/server must not be installed for this check.');
}
`);

    try {
      execFileSync("composer", [
        "install",
        "--no-interaction",
        "--no-plugins",
        "--no-progress",
        "--no-scripts",
        "--prefer-dist",
      ], {
        cwd: packagePath,
        env: {
          ...process.env,
          COMPOSER_CACHE_DIR: join(composerHome, "cache"),
          COMPOSER_HOME: composerHome,
          COMPOSER_NO_INTERACTION: "1",
        },
        maxBuffer: EXTERNAL_COMMAND_MAX_BUFFER_BYTES,
        stdio: "pipe",
        timeout: EXTERNAL_COMMAND_TIMEOUT_MS,
      });
    } finally {
      rmSync(composerHome, { recursive: true, force: true });
      temporaryPaths.splice(temporaryPaths.indexOf(composerHome), 1);
    }

    execFileSync("php", ["verify.php"], {
      cwd: packagePath,
      maxBuffer: EXTERNAL_COMMAND_MAX_BUFFER_BYTES,
      stdio: "inherit",
      timeout: EXTERNAL_COMMAND_TIMEOUT_MS,
    });
  }, 180_000);
});
