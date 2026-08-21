# Contributing

Thanks for contributing to `rsbuild-plugin-source-build`.

## Development setup

1. Fork the repository and clone your fork.
2. Use Node.js 24 to match the version used in CI.
3. Enable Corepack and install dependencies:

```bash
corepack enable
pnpm install
```

The pnpm version is declared by the `packageManager` field in `package.json`.

## Development commands

```bash
# Build the package in watch mode
pnpm dev

# Create a production build
pnpm build
```

## Tests and checks

Add or update tests for behavior changes. Before opening a pull request, run:

```bash
pnpm exec rstest run
pnpm lint
pnpm build
```

Changes to source-build resolution should include focused unit tests. When a
change may affect Rsbuild compatibility, also update the miniature monorepo in
`fixtures/source-build-monorepo` and run the real-version matrix test:

```bash
pnpm exec rstest run test/source-build-versions.test.ts
```

The test workflow runs on both Ubuntu and Windows, so avoid platform-specific
path and symlink assumptions.

## Pull requests

- Create a dedicated branch and keep the pull request focused on one change.
- Include tests for behavior changes and documentation for public API changes.
- Link the related issue when one exists.
- Target the `main` branch.
- Use a [Conventional Commits](https://www.conventionalcommits.org/) style pull
  request title, for example `feat: support scoped source resolution` or
  `fix: preserve package output priority`.
- Describe what changed, why it changed, and how you verified it.
