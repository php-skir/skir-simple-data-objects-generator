import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { generateSimpleDataObjectsFiles } from "../src/generator.js";

describe("generated Simple Data Objects", () => {
  it("validates, hydrates, maps, updates, compares, and round-trips real objects", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "skir-simple-data-objects-generator-"));
    const sourcePath = join(projectPath, "src");
    const composerHome = join(projectPath, ".composer");
    const runtimePath = process.env.SKIR_RUNTIME_PATH ?? resolve("../runtime");

    mkdirSync(sourcePath, { recursive: true });
    mkdirSync(composerHome, { recursive: true });

    writeFileSync(
      join(projectPath, "composer.json"),
      JSON.stringify(
        {
          repositories: [
            {
              type: "path",
              url: runtimePath,
              options: {
                symlink: false,
              },
            },
          ],
          require: {
            php: "^8.4",
            "php-skir/runtime": "*",
            "std-out/simple-data-objects": "^1.11",
          },
          autoload: {
            "psr-4": {
              "App\\Skir\\": "src/",
            },
          },
          config: {
            "sort-packages": true,
          },
          "minimum-stability": "dev",
          "prefer-stable": true,
        },
        null,
        2,
      ),
    );

    const files = generateSimpleDataObjectsFiles({
      config: {
        namespace: "App\\Skir",
        validation: {
          "fixtures.skir": {
            CompanyContact: {
              email: ["company_email"],
            },
          },
        },
      },
      modules: [
        {
          path: "fixtures.skir",
          records: [
            {
              kind: "struct",
              key: "address-key",
              name: "Address",
              fields: [
                { kind: "field", name: "city", number: 0, type: { kind: "string" } },
                { kind: "field", name: "postal_codes", number: 1, type: { kind: "array", item: { kind: "string" } } },
              ],
            },
            {
              kind: "struct",
              name: "CompanyContact",
              fields: [
                { kind: "field", name: "email", number: 0, type: { kind: "string" } },
              ],
            },
            {
              kind: "struct",
              name: "HealthCheckRequest",
              fields: [],
            },
            {
              kind: "struct",
              name: "User",
              fields: [
                { kind: "field", name: "user_id", number: 0, type: { kind: "int32" } },
                { kind: "removed", number: 1 },
                { kind: "field", name: "address", number: 2, type: { kind: "record", key: "address-key", name: "Address" } },
                { kind: "field", name: "previous_addresses", number: 3, type: { kind: "array", item: { kind: "record", key: "address-key", name: "Address" } } },
                { kind: "field", name: "optional_addresses", number: 4, type: { kind: "optional", other: { kind: "array", item: { kind: "record", key: "address-key", name: "Address" } } } },
                { kind: "field", name: "nullable_addresses", number: 5, type: { kind: "array", item: { kind: "optional", other: { kind: "record", key: "address-key", name: "Address" } } } },
                { kind: "field", name: "nested_addresses", number: 6, type: { kind: "array", item: { kind: "array", item: { kind: "record", key: "address-key", name: "Address" } } } },
                { kind: "field", name: "labels", number: 7, type: { kind: "array", item: { kind: "string" } } },
                { kind: "field", name: "nickname", number: 8, type: { kind: "optional", other: { kind: "string" } } },
                { kind: "field", name: "large_id", number: 9, type: { kind: "int64" } },
                { kind: "field", name: "status", number: 10, type: { kind: "record", name: "SubscriptionStatus", recordType: "enum" } },
              ],
            },
            {
              recordType: "enum",
              name: "SubscriptionStatus",
              fields: [
                { kind: "field", name: "free", number: 1 },
                { kind: "field", name: "premium_since", number: 2, type: { kind: "timestamp" } },
              ],
            },
          ],
        },
      ],
    });

    for (const file of files.filter((file) => file.path.endsWith(".php"))) {
      const filePath = join(sourcePath, file.path);

      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, file.code);
      execFileSync("php", ["-l", filePath], { stdio: "pipe" });
    }

    writeFileSync(
      join(projectPath, "verify.php"),
      `<?php

declare(strict_types=1);

require __DIR__.'/vendor/autoload.php';

use App\\Skir\\AddressData;
use App\\Skir\\CompanyContactData;
use App\\Skir\\HealthCheckRequestData;
use App\\Skir\\SubscriptionStatusData;
use App\\Skir\\UserData;
use Illuminate\\Translation\\ArrayLoader;
use Illuminate\\Translation\\Translator;
use Illuminate\\Validation\\Factory as ValidatorFactory;
use Illuminate\\Validation\\ValidationException;
use StdOut\\SimpleDataObjects\\BaseData;
use StdOut\\SimpleDataObjects\\TypedDataCollection;

$validator = new ValidatorFactory(new Translator(new ArrayLoader(), 'en'));
$validator->extend('company_email', static fn (string $attribute, mixed $value): bool => is_string($value) && str_ends_with($value, '@company.test'));
BaseData::setValidatorFactory($validator);

$contact = CompanyContactData::makeFromSkirPayload(['email' => 'maxim@company.test']);

if ($contact->email !== 'maxim@company.test') {
    throw new RuntimeException('Unexpected validated contact.');
}

try {
    CompanyContactData::makeFromSkirPayload(['email' => 'maxim@example.test']);
    throw new RuntimeException('Expected custom company email validation to fail.');
} catch (ValidationException) {
}

$payload = [
    'user_id' => 400,
    'address' => ['city' => 'Antwerp', 'postal_codes' => ['2000', '2018']],
    'previous_addresses' => [
        ['city' => 'Brussels', 'postal_codes' => ['1000']],
        ['city' => 'Ghent', 'postal_codes' => ['9000']],
    ],
    'optional_addresses' => [['city' => 'Leuven', 'postal_codes' => ['3000']]],
    'nullable_addresses' => [null, ['city' => 'Bruges', 'postal_codes' => ['8000']]],
    'nested_addresses' => [[['city' => 'Hasselt', 'postal_codes' => ['3500']]]],
    'labels' => ['admin', 'beta'],
    'nickname' => 'johnny',
    'large_id' => '9223372036854775808',
    'status' => SubscriptionStatusData::premiumSince(1743682787000)->toSkirValue(),
];
$user = UserData::makeFromSkirPayload($payload);

if (! $user->address instanceof AddressData || $user->address->city !== 'Antwerp') {
    throw new RuntimeException('Unexpected direct struct hydration.');
}

if (! $user->previousAddresses instanceof TypedDataCollection || count($user->previousAddresses) !== 2) {
    throw new RuntimeException('Unexpected typed data collection.');
}

if (! $user->previousAddresses->all()[0] instanceof AddressData) {
    throw new RuntimeException('Unexpected typed collection contents.');
}

if (! $user->optionalAddresses instanceof TypedDataCollection || $user->nullableAddresses[0] !== null) {
    throw new RuntimeException('Unexpected nullable collection values.');
}

if (! $user->nullableAddresses[1] instanceof AddressData || ! $user->nestedAddresses[0][0] instanceof AddressData) {
    throw new RuntimeException('Unexpected recursively hydrated arrays.');
}

$serialized = $user->toArray();

if ($serialized['user_id'] !== 400 || array_key_exists('userId', $serialized)) {
    throw new RuntimeException('Mapped property names were not preserved.');
}

$updated = $user->with(userId: 401);

if ($updated->userId !== 401 || $user->userId !== 400 || $updated->equals($user)) {
    throw new RuntimeException('Unexpected immutable update or equality behavior.');
}

if (! $user->equals(UserData::from($user->toArray()))) {
    throw new RuntimeException('Unexpected equality behavior for equivalent data.');
}

$userWithoutOptionalAddresses = UserData::makeFromSkirPayload([
    ...$payload,
    'optional_addresses' => null,
]);

if ($userWithoutOptionalAddresses->optionalAddresses !== null) {
    throw new RuntimeException('Unexpected nullable typed collection hydration.');
}

$json = $user->toSkirJson();
$decoded = UserData::fromSkir($json);

if ($decoded->userId !== $user->userId || $decoded->address->city !== $user->address->city || $decoded->toSkirJson() !== $json) {
    throw new RuntimeException('Unexpected dense JSON round trip.');
}

if ((new HealthCheckRequestData())->toSkirJson() !== '[]') {
    throw new RuntimeException('Unexpected empty struct dense JSON.');
}

try {
    UserData::makeFromSkirPayload([
        ...$payload,
        'address' => ['city' => 42, 'postal_codes' => ['2000']],
    ]);
    throw new RuntimeException('Expected recursive raw validation to fail.');
} catch (ValidationException) {
}
`,
    );

    if (!existsSync(join(projectPath, "vendor", "autoload.php"))) {
      execFileSync("composer", ["install", "--no-interaction", "--no-progress"], {
        cwd: projectPath,
        env: {
          ...process.env,
          COMPOSER_HOME: composerHome,
        },
        stdio: "pipe",
      });
    }

    execFileSync("php", ["verify.php"], {
      cwd: projectPath,
      stdio: "inherit",
    });

    expect(files.map((file) => file.path).sort()).toEqual([
      "AddressData.php",
      "CompanyContactData.php",
      "HealthCheckRequestData.php",
      "SubscriptionStatusData.php",
      "UserData.php",
      "skir-server-manifest.json",
    ]);
  }, 180_000);
});
