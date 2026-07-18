# Package Instructions

This repository is the Simple Data Objects Skir generator.

- npm package name: `skir-simple-data-objects-generator`.
- It should generate `std-out/simple-data-objects` data objects for Skir structs.
- Generated PHP should depend on `std-out/simple-data-objects` for DTO creation, mapping, collections, and validation.
- Generated PHP should depend on `php-skir/runtime` for wire-format behavior.
- Keep server routing and client HTTP behavior out of this package.
- Before committing, run `npm ci`, `npm run typecheck`, `npm run build`, `npm run pack:dry-run`, and `npm test`.
