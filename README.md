# Skir Simple Data Objects Generator

Generates [`std-out/simple-data-objects`](https://github.com/std-out/simple-data-objects) DTOs, typed RPC clients, and server procedure contracts from Skir schemas.

Generated PHP uses `php-skir/runtime` for Skir wire formats and `std-out/simple-data-objects` for immutable DTO hydration, mapped property names, typed collections, serialization, and validation.

## Quick start

Prerequisites: PHP 8.4 or newer, Composer 2, and a supported Node.js release.

Install Skir and this generator as development dependencies, then install the PHP runtime and DTO library:

```bash
npm install --save-dev skir skir-simple-data-objects-generator
composer require php-skir/runtime std-out/simple-data-objects
```

Create `skir-src/users.skir`:

```skir
struct User {
  user_id: int32;
  email: string;
  nickname: string?;
}
```

Add the generator to the root `skir.yml`:

```yaml
generators:
  - mod: skir-simple-data-objects-generator
    outDir: generated/php/skirout
    config:
      namespace: Skir
      validation:
        users.skir:
          User:
            email:
              - email
```

Generate the PHP files and configure Composer autoloading:

```bash
npx skir gen
npx skir-simple-data-objects-generator configure-composer
composer dump-autoload
```

The generated `Skir\UserData` class is now ready to use:

```php
use Skir\UserData;

$user = UserData::makeFromSkirPayload([
    'user_id' => 400,
    'email' => 'maxim@example.com',
]);

$json = $user->toSkirJson();
$decoded = UserData::fromSkir($json);

$decoded->userId; // 400
$decoded->nickname; // null
```

The root namespace defaults to `Skir`, so `config.namespace` is optional when that default is suitable.

## Generated output is owned by Skir

Skir owns the configured `outDir` and may replace or delete anything inside it. Use a dedicated path ending in `/skirout`, do not put handwritten PHP there, and never edit a generated file. Change the `.skir` source or generator configuration and regenerate instead.

Source directories below `skir-src` become PHP subnamespaces and output directories. The `.skir` filename itself does not add a namespace segment:

```text
skir-src/admin/users.skir -> generated/php/skirout/Admin/UserData.php
                          -> Skir\Admin\UserData
```

Generated struct and enum class names end in `Data`. A Skir field such as `user_id` becomes the PHP property `$userId`, with `#[MapPropertyName('user_id')]` preserving the original name for hydration and `toArray()` output.

## Composer configuration

Run Skir generation before `configure-composer`: the command verifies that every configured output directory exists before changing `composer.json`.

```text
skir-simple-data-objects-generator configure-composer [--root <dir>] [--mod <module>]
```

In a normal npm project, invoke it through `npx`:

```bash
npx skir-simple-data-objects-generator configure-composer
```

The command reads `skir.yml` and `composer.json`, finds the exact `mod: skir-simple-data-objects-generator` entry, and adds the configured namespace and `outDir` as a Composer PSR-4 mapping. It changes only `composer.json`; run `composer dump-autoload` afterward.

Use `--root <dir>` for another project root. Use `--mod <module>` when the configured module is an exact alternative identifier, such as a local file URL:

```bash
npx skir-simple-data-objects-generator configure-composer \
  --root ../api \
  --mod file:///path/to/skir-simple-data-objects-generator/dist/index.js
```

An equivalent existing mapping is left byte-for-byte unchanged. A conflicting mapping, invalid configuration, missing output directory, or path outside the project root fails without modifying `composer.json`.

## Generated data objects

### Struct APIs

Every Skir struct generates a final class extending `StdOut\SimpleDataObjects\BaseData`. In addition to its readonly constructor properties, it exposes:

| Method | Purpose |
| --- | --- |
| `skirType()` | Return the runtime `Type` descriptor. |
| `makeFromSkirPayload(array $data)` | Validate raw named Skir data, recursively hydrate nested values, and return the DTO. |
| `fromSkir(string $json)` | Decode dense Skir JSON and delegate to `makeFromSkirPayload()`. |
| `toSkirArray()` | Convert DTO values to the named array representation expected by the runtime. |
| `toSkir()` | Encode the DTO as the dense PHP array representation. |
| `toSkirJson()` | Encode the DTO as dense Skir JSON. |

Generated classes inherit the current `BaseData` APIs, including `from()`, `fromValidated()`, `validate()`, `toArray()`, `toJson()`, `with()`, `equals()`, `diff()`, `only()`, `except()`, `collection()`, and `lazyCollection()`.

Use PHP property names with `with()`, but original Skir names in raw payloads and serialized arrays:

```php
$updated = $user->with(userId: 401);

$updated->userId; // 401
$updated->toArray()['user_id']; // 401
$updated->equals($user); // false
```

`BaseData::from()` hydrates without validation. Use `makeFromSkirPayload()` for raw Skir data: it applies the generated validation contract and performs the Skir-specific recursive conversions before calling `BaseData::from()`.

`BaseData::collection()`, `BaseData::lazyCollection()`, and `TypedDataCollection::of()` are also trusted hydration paths. Like `from()`, they do not execute generated `#[Rules]` validation. Construct collections from DTOs or other trusted values:

```php
use Skir\AddressData;

$addresses = AddressData::collection([
    AddressData::makeFromSkirPayload([
        'city' => 'Antwerp',
        'postal_codes' => ['2000'],
    ]),
]);

foreach ($addresses as $address) {
    echo $address->city;
}
```

For untrusted raw item arrays, call `AddressData::makeFromSkirPayload()` for each item before constructing a collection. When the collection belongs to a generated parent DTO or RPC request, prefer passing the complete raw parent payload through the parent's `makeFromSkirPayload()` or generated RPC hydration path; those paths validate each nested struct before collection construction.

### Struct collections

Only a direct array of structs becomes a `TypedDataCollection`:

| Skir shape | Generated PHP type |
| --- | --- |
| `[Address]` | `TypedDataCollection` with `#[DataCollection(AddressData::class)]` |
| `[Address]?` | `?TypedDataCollection` with the same collection attribute |
| `[[Address]]` | `array` |
| `[Address?]` | `array` |
| `[string]` or `[SomeEnum]` | `array` |

Nested arrays and arrays whose item is optional remain normal PHP arrays, although supported nested structs and enum wrappers are still converted recursively.

### Wrapper enums

Skir enums generate readonly wrapper classes with a `Data` suffix. Constant variants have parameterless named constructors; payload variants have typed named constructors. Generated enum classes expose `name()`, `payload()`, `skirType()`, `toSkirValue()`, `fromSkirValue()`, `toDenseValue()`, `fromDenseValue()`, `toDenseJson()`, and `fromDenseJson()`.

Structs, typed struct collections, nested arrays, optionals, and nested enum wrappers are converted to wire values when stored in a wrapper and converted back to target DTO values when `payload()` is read.

## Validation

The generator emits `#[Rules]` attributes understood by Simple Data Objects and Laravel's validator. Rules are deterministic: generated structural rules come first, followed by configured string rules in their exact configured order.

### Structural rules

Every non-optional field starts with `required`. Every optional field starts with `nullable`, so the key may be omitted or its value may be `null`. A safely representable shape rule follows when available:

| Skir type | Generated shape rule |
| --- | --- |
| `bool` | `boolean` |
| `int32`, `timestamp` | `integer` |
| `float32`, `float64` | `numeric` |
| `string`, `bytes` | `string` |
| any array | `array` |
| struct reference | `array` |
| enum reference, `mixed` | none |
| `int64`, `hash64` | none |

`int64` and `hash64` deliberately receive no narrowing rule because their PHP representation is `int|string`.

Array validation is structural only at the field level. The generator emits `array`, but not wildcard item rules such as `field.*`. Array-shaped nested structs are recursively hydrated through their own `makeFromSkirPayload()` method and therefore run their own field rules. Put additional element constraints in custom named rules or at a handwritten application boundary.

### Validation and hydration order

`makeFromSkirPayload()` processes input in this order:

1. Validate the raw parent array with `self::validate($data)`.
2. Convert mapped names and recursively hydrate nested structs, collections, arrays, and enum wrappers. Each nested struct validates its own raw array before hydration.
3. Pass the already validated and prepared values to `self::from($payload)`.

Generated RPC providers use the same raw-to-target conversion for incoming requests, and generated clients use it for responses. Direct struct requests and every recursively hydrated nested struct are validated before application code receives them.

The final `BaseData::from()` call is intentionally a hydration-only operation and does not validate by itself. Calling `SomeData::from($untrustedInput)` directly bypasses the generated raw-first validation sequence.

### Validation overlays

Configure application-specific rules under `config.validation` in `skir.yml`:

```yaml
generators:
  - mod: skir-simple-data-objects-generator
    outDir: generated/php/skirout
    config:
      namespace: Skir
      validation:
        admin/users.skir:
          "Envelope.Metadata":
            display_name:
              - min:2
              - max:80
            email_address:
              - email:rfc
              - company_email
```

Selectors use the original Skir identities, in this order:

1. Module path relative to `skir-src`, such as `admin/users.skir`.
2. Qualified record name, such as `Envelope.Metadata`.
3. Original Skir field name, such as `display_name`, not the generated `$displayName` property.

Unknown modules, records, or fields fail generation instead of silently dropping a rule. Enum variants, removed fields, and other non-struct payload fields cannot receive validation overlays.

Only non-empty string rules can be encoded in `skir.yml`. The generator appends them after structural rules without reordering them. Register every custom named rule before generated DTO validation runs.

### Register custom rules in Laravel

Laravel's validator is available to `BaseData` through the application container. Register custom named rules during application boot:

```php
namespace App\Providers;

use Illuminate\Support\Facades\Validator;
use Illuminate\Support\ServiceProvider;

final class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Validator::extend(
            'company_email',
            static fn (string $attribute, mixed $value): bool =>
                is_string($value) && str_ends_with($value, '@company.test'),
        );
    }
}
```

Register the rule before any generated `makeFromSkirPayload()`, `fromSkir()`, or RPC hydration call that may use it.

### Register custom rules without Laravel

Standalone applications can create and install an Illuminate validator factory:

```php
use Illuminate\Translation\ArrayLoader;
use Illuminate\Translation\Translator;
use Illuminate\Validation\Factory as ValidatorFactory;
use StdOut\SimpleDataObjects\BaseData;

$validator = new ValidatorFactory(
    new Translator(new ArrayLoader(), 'en'),
);
$validator->extend(
    'company_email',
    static fn (string $attribute, mixed $value): bool =>
        is_string($value) && str_ends_with($value, '@company.test'),
);

BaseData::setValidatorFactory($validator);
```

Install the configured factory before the first generated validation call.

### Handwritten validation boundaries

Laravel rule objects and closures cannot be represented in `skir.yml`; only strings are portable generator configuration. Keep request-specific authorization, database-aware rules, uploaded-file rules, closure rules, normalization, and other application behavior in a handwritten Laravel Form Request or equivalent application-owned validation boundary.

That boundary must live outside `skirout`, because regeneration overwrites generated files. It complements the generated wire-shape and named-rule validation instead of modifying generated DTOs.

## RPC clients, procedures, and manifests

When a schema contains methods, the generator emits six module-scoped PHP RPC files plus `skir-server-manifest.json`:

- `SkirMethods.php` with runtime `MethodDescriptor` instances.
- A module method enum such as `AdminSkirMethod.php`.
- `SkirRpcClient.php` with typed request and response conversion.
- `SkirProcedures.php` and `AbstractSkirProcedures.php` for implementation contracts.
- `SkirProcedureProvider.php` for server registration.
- `skir-server-manifest.json` with exact module and method identities and `Data`-suffixed struct and enum classes.

Install the client package when using the generated RPC client:

```bash
composer require php-skir/client
```

Install the server package when using generated procedure contracts or providers:

```bash
composer require php-skir/server
```

RPC methods retain target types at the application boundary. Direct struct collections are accepted and returned as `TypedDataCollection`; nested collection shapes remain arrays. The generated client converts requests to raw Skir values and hydrates responses. The generated providers validate and hydrate incoming raw values before calling application code, then convert returned DTOs back to Skir values.

This generator emits contracts and conversions only. HTTP transport and server routing remain the responsibility of `php-skir/client`, `php-skir/server`, and the application.

## Development and contributing

Install dependencies and run the complete package verification sequence:

```bash
npm ci
npm run typecheck
npm run build
npm run pack:dry-run
SKIR_RUNTIME_PATH=../runtime npm test
git diff --check
```

The integration tests require PHP 8.4, Composer, and a local checkout of `php-skir/runtime`. Pull requests should keep generated output behavior covered by source assertions and executable PHP integration tests.

### Develop against a local generator core

Build the core first. Before the initial compatible core release and adapter lockfile commit, one no-save install can install this package's development dependencies and satisfy `@php-skir/generator-core` from the local checkout without creating a lockfile:

```bash
cd ../generator-core
npm ci
npm run build

cd ../skir-simple-data-objects-generator
npm install --no-save --package-lock=false ../generator-core
```

Once the compatible core package has been published and this repository has committed its normal `package-lock.json`, use `npm ci` instead of the local-path bootstrap.

## Releasing

Release the shared packages in dependency order:

1. Merge and publish `@php-skir/generator-core` with the required adapter APIs.
2. Replace the local link with the published compatible core version and commit the resulting `package-lock.json` update.
3. Run `npm ci`, typecheck, build, package validation, the full test suite, and `git diff --check` again.
4. Create the Simple Data Objects generator release only after those checks pass.

The release workflow uses Node 24 and npm trusted publishing with provenance. Configure this GitHub repository as an npm trusted publisher before publishing; no release or publish action is performed by the test workflow.
