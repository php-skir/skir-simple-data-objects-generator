import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { generateSimpleDataObjectsFiles } from "../src/generator.js";

const EXTERNAL_COMMAND_TIMEOUT_MS = 120_000;
const EXTERNAL_COMMAND_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const temporaryPaths: string[] = [];

afterEach(() => {
  for (const temporaryPath of temporaryPaths.splice(0)) {
    rmSync(temporaryPath, { recursive: true, force: true });
  }
});

describe("generated Simple Data Objects", () => {
  it("validates, hydrates, maps, updates, compares, and round-trips real objects", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "skir-simple-data-objects-generator-"));
    temporaryPaths.push(projectPath);
    const sourcePath = join(projectPath, "src");
    const composerHome = mkdtempSync(join(tmpdir(), "skir-simple-data-objects-composer-"));
    temporaryPaths.push(composerHome);
    const runtimePath = process.env.SKIR_RUNTIME_PATH ?? resolve("../runtime");

    mkdirSync(sourcePath, { recursive: true });

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
              "Skir\\Client\\": "stubs/Skir/Client/",
              "Skir\\Server\\": "stubs/Skir/Server/",
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
            ControlRules: {
              line_feed: ["line\nfeed"],
              carriage_return: ["carriage\rreturn"],
              both: ["both\r\nlines"],
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
              name: "ControlRules",
              fields: [
                { kind: "field", name: "line_feed", number: 0, type: { kind: "string" } },
                { kind: "field", name: "carriage_return", number: 1, type: { kind: "string" } },
                { kind: "field", name: "both", number: 2, type: { kind: "string" } },
              ],
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
            {
              recordType: "enum",
              name: "AddressEvent",
              fields: [
                { kind: "field", name: "moved_to", number: 1, type: { kind: "record", key: "address-key", name: "Address" } },
                { kind: "field", name: "visited", number: 2, type: { kind: "array", item: { kind: "record", key: "address-key", name: "Address" } } },
                { kind: "field", name: "maybe_moved_to", number: 3, type: { kind: "optional", other: { kind: "record", key: "address-key", name: "Address" } } },
                { kind: "field", name: "maybe_visited", number: 4, type: { kind: "optional", other: { kind: "array", item: { kind: "record", key: "address-key", name: "Address" } } } },
                { kind: "field", name: "routes", number: 5, type: { kind: "array", item: { kind: "array", item: { kind: "record", key: "address-key", name: "Address" } } } },
                { kind: "field", name: "status_changed", number: 6, type: { kind: "record", name: "SubscriptionStatus", recordType: "enum" } },
              ],
            },
          ],
          methods: [{
            kind: "method",
            name: "SyncAddresses",
            number: 42,
            requestType: { kind: "array", item: { kind: "record", key: "address-key", name: "Address" } },
            responseType: { kind: "array", item: { kind: "record", key: "address-key", name: "Address" } },
          }],
        },
      ],
    });

    for (const file of files.filter((file) => file.path.endsWith(".php"))) {
      const filePath = join(sourcePath, file.path);

      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, file.code);
      execFileSync("php", ["-l", filePath], {
        maxBuffer: EXTERNAL_COMMAND_MAX_BUFFER_BYTES,
        stdio: "pipe",
        timeout: EXTERNAL_COMMAND_TIMEOUT_MS,
      });
    }

    const stubFiles: Readonly<Record<string, string>> = {
      "Skir/Client/SkirClient.php": `<?php

declare(strict_types=1);

namespace Skir\\Client;

use Closure;
use Skir\\Runtime\\MethodDescriptor;

final readonly class SkirClient
{
    public function __construct(private Closure $handler) {}

    public function invoke(MethodDescriptor $method, mixed $request): mixed
    {
        return ($this->handler)($method, $request);
    }
}
`,
      "Skir/Server/Contracts/SkirMethodReference.php": `<?php

declare(strict_types=1);

namespace Skir\\Server\\Contracts;

use Skir\\Runtime\\MethodDescriptor;

interface SkirMethodReference
{
    public function descriptor(): MethodDescriptor;
}
`,
      "Skir/Server/ProcedureProvider.php": `<?php

declare(strict_types=1);

namespace Skir\\Server;

interface ProcedureProvider
{
    public function register(SkirServer $server): void;
}
`,
      "Skir/Server/SkirContext.php": `<?php

declare(strict_types=1);

namespace Skir\\Server;

final readonly class SkirContext {}
`,
      "Skir/Server/SkirServer.php": `<?php

declare(strict_types=1);

namespace Skir\\Server;

use Closure;
use RuntimeException;
use Skir\\Runtime\\MethodDescriptor;

final class SkirServer
{
    /** @var array<string, Closure> */
    private array $methods = [];

    public function addMethod(MethodDescriptor $method, Closure $handler): void
    {
        $this->methods[$method->name] = $handler;
    }

    public function invoke(string $method, mixed $request): mixed
    {
        $handler = $this->methods[$method] ?? throw new RuntimeException('Missing method '.$method.'.');

        return $handler($request, new SkirContext());
    }
}
`,
    };

    for (const [path, source] of Object.entries(stubFiles)) {
      const filePath = join(projectPath, "stubs", path);

      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, source);
      execFileSync("php", ["-l", filePath], {
        maxBuffer: EXTERNAL_COMMAND_MAX_BUFFER_BYTES,
        stdio: "pipe",
        timeout: EXTERNAL_COMMAND_TIMEOUT_MS,
      });
    }

    writeFileSync(
      join(projectPath, "verify.php"),
      `<?php

declare(strict_types=1);

require __DIR__.'/vendor/autoload.php';

use App\\Skir\\AddressData;
use App\\Skir\\AddressEventData;
use App\\Skir\\AbstractSkirProcedures;
use App\\Skir\\CompanyContactData;
use App\\Skir\\ControlRulesData;
use App\\Skir\\HealthCheckRequestData;
use App\\Skir\\SkirProcedureProvider;
use App\\Skir\\SkirProcedures;
use App\\Skir\\SkirRpcClient;
use App\\Skir\\SubscriptionStatusData;
use App\\Skir\\UserData;
use Composer\\InstalledVersions;
use Illuminate\\Translation\\ArrayLoader;
use Illuminate\\Translation\\Translator;
use Illuminate\\Validation\\Factory as ValidatorFactory;
use Illuminate\\Validation\\ValidationException;
use Skir\\Client\\SkirClient;
use Skir\\Runtime\\EnumValue;
use Skir\\Runtime\\MethodDescriptor;
use Skir\\Server\\SkirContext;
use Skir\\Server\\SkirServer;
use StdOut\\SimpleDataObjects\\BaseData;
use StdOut\\SimpleDataObjects\\Attributes\\Rules;
use StdOut\\SimpleDataObjects\\TypedDataCollection;

$validator = new ValidatorFactory(new Translator(new ArrayLoader(), 'en'));
$validator->extend('company_email', static fn (string $attribute, mixed $value): bool => is_string($value) && str_ends_with($value, '@company.test'));
BaseData::setValidatorFactory($validator);

if (! InstalledVersions::isInstalled('std-out/simple-data-objects')) {
    throw new RuntimeException('The real Simple Data Objects package is not installed.');
}

if (! InstalledVersions::isInstalled('php-skir/runtime')) {
    throw new RuntimeException('The real Skir runtime package is not installed.');
}

$simpleDataObjectsSource = (new ReflectionClass(BaseData::class))->getFileName();
$runtimeSource = (new ReflectionClass(EnumValue::class))->getFileName();

if (! is_string($simpleDataObjectsSource) || ! str_contains($simpleDataObjectsSource, '/vendor/std-out/simple-data-objects/')) {
    throw new RuntimeException('Simple Data Objects did not load from its Composer package.');
}

if (! is_string($runtimeSource) || ! str_contains($runtimeSource, '/vendor/php-skir/runtime/')) {
    throw new RuntimeException('The Skir runtime did not load from its Composer package.');
}

$controlParameters = (new ReflectionClass(ControlRulesData::class))
    ->getConstructor()
    ->getParameters();
$controlRules = array_map(
    static fn (ReflectionParameter $parameter): array => $parameter
        ->getAttributes(Rules::class)[0]
        ->newInstance()
        ->rules,
    $controlParameters,
);

if ($controlRules[0][2] !== "line\nfeed") {
    throw new RuntimeException('LF validation rule value changed.');
}

if ($controlRules[1][2] !== "carriage\rreturn") {
    throw new RuntimeException('CR validation rule value changed.');
}

if ($controlRules[2][2] !== "both\r\nlines") {
    throw new RuntimeException('CRLF validation rule value changed.');
}

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

$payloadWithoutOptionals = $payload;
unset($payloadWithoutOptionals['optional_addresses'], $payloadWithoutOptionals['nickname']);

set_error_handler(static function (int $severity, string $message, string $file, int $line): never {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

try {
    $userWithoutOptionalAddresses = UserData::makeFromSkirPayload($payloadWithoutOptionals);
} finally {
    restore_error_handler();
}

if ($userWithoutOptionalAddresses->optionalAddresses !== null || $userWithoutOptionalAddresses->nickname !== null) {
    throw new RuntimeException('Unexpected omitted optional hydration.');
}

$json = $user->toSkirJson();
$decoded = UserData::fromSkir($json);

if ($decoded->userId !== $user->userId || $decoded->address->city !== $user->address->city || $decoded->toSkirJson() !== $json) {
    throw new RuntimeException('Unexpected dense JSON round trip.');
}

if ((new HealthCheckRequestData())->toSkirJson() !== '[]') {
    throw new RuntimeException('Unexpected empty struct dense JSON.');
}

$movedTo = AddressEventData::movedTo(
    AddressData::makeFromSkirPayload(['city' => 'Kortrijk', 'postal_codes' => ['8500']]),
);

if (! is_array($movedTo->toSkirValue()->value)) {
    throw new RuntimeException('Direct enum struct payload was not stored as wire data.');
}

$decodedMovedTo = AddressEventData::fromDenseJson($movedTo->toDenseJson())->payload();

if (! $decodedMovedTo instanceof AddressData || $decodedMovedTo->city !== 'Kortrijk') {
    throw new RuntimeException('Direct enum struct payload did not round trip.');
}

$visited = AddressEventData::visited($user->previousAddresses);

if (! is_array($visited->toSkirValue()->value)) {
    throw new RuntimeException('Enum collection payload was not stored as wire data.');
}

$decodedVisited = AddressEventData::fromDenseJson($visited->toDenseJson())->payload();

if (! $decodedVisited instanceof TypedDataCollection || count($decodedVisited) !== 2 || ! $decodedVisited->all()[0] instanceof AddressData) {
    throw new RuntimeException('Enum typed collection payload did not round trip.');
}

$maybeMovedTo = AddressEventData::maybeMovedTo($user->address);
$decodedMaybeMovedTo = AddressEventData::fromDenseJson($maybeMovedTo->toDenseJson())->payload();

if (! $decodedMaybeMovedTo instanceof AddressData || $decodedMaybeMovedTo->city !== 'Antwerp') {
    throw new RuntimeException('Optional enum struct payload did not round trip.');
}

$maybeVisited = AddressEventData::maybeVisited($user->previousAddresses);
$decodedMaybeVisited = AddressEventData::fromDenseJson($maybeVisited->toDenseJson())->payload();

if (! $decodedMaybeVisited instanceof TypedDataCollection || count($decodedMaybeVisited) !== 2) {
    throw new RuntimeException('Optional enum typed collection did not round trip.');
}

if (AddressEventData::maybeVisited(null)->payload() !== null) {
    throw new RuntimeException('Null optional enum typed collection changed.');
}

$routes = AddressEventData::routes([[$user->address]]);
$decodedRoutes = AddressEventData::fromDenseJson($routes->toDenseJson())->payload();

if (! is_array($routes->toSkirValue()->value) || ! $decodedRoutes[0][0] instanceof AddressData) {
    throw new RuntimeException('Nested enum struct arrays did not round trip.');
}

$client = new SkirRpcClient(new SkirClient(
    static function (MethodDescriptor $method, mixed $request): mixed {
        if ($method->name !== 'SyncAddresses' || ! is_array($request) || $request[0]['city'] !== 'Brussels') {
            throw new RuntimeException('The generated client did not send a raw struct collection.');
        }

        return $request;
    },
));
$clientResponse = $client->syncAddresses($user->previousAddresses);

if (! $clientResponse instanceof TypedDataCollection || ! $clientResponse->all()[0] instanceof AddressData) {
    throw new RuntimeException('The generated client did not hydrate its collection response.');
}

$procedures = new class implements SkirProcedures {
    public function syncAddresses(TypedDataCollection $request, SkirContext $context): TypedDataCollection
    {
        if (! $request->all()[0] instanceof AddressData) {
            throw new RuntimeException('The generated provider did not hydrate its collection request.');
        }

        return $request;
    }
};
$providerServer = new SkirServer();
(new SkirProcedureProvider($procedures))->register($providerServer);
$providerResponse = $providerServer->invoke('SyncAddresses', $payload['previous_addresses']);

if (! is_array($providerResponse) || $providerResponse[0]['city'] !== 'Brussels') {
    throw new RuntimeException('The generated provider did not unwrap its collection response.');
}

$abstractProcedures = new class extends AbstractSkirProcedures {
    public function syncAddresses(TypedDataCollection $request, SkirContext $context): TypedDataCollection
    {
        return $request;
    }
};
$abstractServer = new SkirServer();
$abstractProcedures->register($abstractServer);
$abstractResponse = $abstractServer->invoke('SyncAddresses', $payload['previous_addresses']);

if (! is_array($abstractResponse) || $abstractResponse[1]['city'] !== 'Ghent') {
    throw new RuntimeException('The generated abstract provider collection boundary failed.');
}

$statusChanged = AddressEventData::statusChanged(SubscriptionStatusData::free());
$decodedStatus = AddressEventData::fromDenseJson($statusChanged->toDenseJson())->payload();

if (! $decodedStatus instanceof SubscriptionStatusData || $decodedStatus->name() !== 'free') {
    throw new RuntimeException('Nested enum payload did not round trip.');
}

try {
    AddressEventData::fromSkirValue(
        EnumValue::wrapper('moved_to', ['city' => 42, 'postal_codes' => ['8500']]),
    )->payload();
    throw new RuntimeException('Expected enum struct payload validation to fail.');
} catch (ValidationException) {
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

    expect(files.map((file) => file.path).sort()).toEqual([
      "AbstractSkirProcedures.php",
      "AddressData.php",
      "AddressEventData.php",
      "CompanyContactData.php",
      "ControlRulesData.php",
      "HealthCheckRequestData.php",
      "SkirMethod.php",
      "SkirMethods.php",
      "SkirProcedureProvider.php",
      "SkirProcedures.php",
      "SkirRpcClient.php",
      "SubscriptionStatusData.php",
      "UserData.php",
      "skir-server-manifest.json",
    ]);
  }, 180_000);
});
