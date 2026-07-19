import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      "struct User {",
      "  user_id: int32;",
      "  name: string;",
      "  address: Address;",
      "  previous_addresses: [Address];",
      "  optional_addresses: [Address]?;",
      "  nested_addresses: [[Address]];",
      "  nickname: string?;",
      "  subscription_status: SubscriptionStatus;",
      "}",
      "",
      "enum SubscriptionStatus {",
      "  free;",
      "  premium_since: timestamp;",
      "}",
      "",
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
        "std-out/simple-data-objects": "^1.11",
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
});
