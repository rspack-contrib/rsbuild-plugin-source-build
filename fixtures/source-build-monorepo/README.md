# Source-build monorepo fixture

This fixture is copied to a temporary directory by the Rsbuild version-matrix
integration test. The test creates workspace links at runtime so the repository
does not contain generated `node_modules` entries.

It covers these source-build boundaries:

- `source-first`: a direct workspace dependency built from TypeScript source.
- `transitive`: a transitive workspace dependency built from source.
- `output-first`: a selected dependency using a package-level output priority.
- `undeclared`: a linked workspace package outside the app dependency graph.
- `vendor/external`: a non-workspace package that also declares `source`.
