# AGENTS.md

## Purpose
This repository is an AdonisJS v7 package starter kit for building a published npm package.
Agents should preserve the starter's conventions unless the user asks for a structural change.

## Repository Facts
- Package manager: npm
- Runtime: Node.js `>=24.0.0`
- Module system: ESM (`"type": "module"`)
- Language: TypeScript
- Test runner: Japa
- Linting: ESLint via `@adonisjs/eslint-config`
- Formatting: Prettier via `@adonisjs/prettier-config`
- Build output: `build/`
- Coverage tool: `c8`

## Important Paths
- `index.ts`: main package entrypoint
- `configure.ts`: `node ace configure` hook entrypoint
- `src/`: package source code
- `providers/`: service providers intended to be exported
- `stubs/`: stub files copied into `build/` during compile
- `bin/test.ts`: Japa test bootstrap
- `tests/**/*.spec.ts`: test files
- `package.json`: scripts, exports, publish settings

## Agent Instruction Sources
- `AGENTS.md`: this file
- `.cursorrules`: not present as of this analysis
- `.cursor/rules/`: not present as of this analysis
- `.github/copilot-instructions.md`: not present as of this analysis
If any of those files are added later, treat them as higher-priority repository guidance and update this file.

## Install
Run this before linting, testing, or building in a fresh checkout:

```bash
npm install
```

At the time of analysis, dependencies were not installed, so the test commands below were validated from `package.json`, `bin/test.ts`, and Japa documentation rather than a live run.

## Core Commands
```bash
npm run lint
npm run format
npm run typecheck
npm run quick:test
npm run test
npm run build
```

## Recommended Validation Flow
For a normal code change:

```bash
npm run lint
npm run typecheck
npm run quick:test
```

For release-ready verification:

```bash
npm run test
npm run build
```

## Running Tests
The repo's test entrypoint is `bin/test.ts`, which calls `processCLIArgs(process.argv.splice(2))`. That means Japa CLI filters can be passed through `npm run quick:test -- ...`.

Run all tests:

```bash
npm run quick:test
```

Run one test file by Japa file filter:

```bash
npm run quick:test -- --files="example"
npm run quick:test -- --files="tests/example.spec.ts"
```

Run one test group:

```bash
npm run quick:test -- --groups="Example"
```

Run one test by exact title:

```bash
npm run quick:test -- --tests="add two numbers"
```

Direct bootstrap invocation also works:

```bash
node --import=@poppinss/ts-exec --enable-source-maps bin/test.ts --files="tests/example.spec.ts"
```

Use `quick:test` while iterating and `test` before declaring work complete.

## Build Notes
- Production output goes to `build/`
- `tsdown` bundles `index.ts` and `configure.ts`
- Declaration files are emitted separately with `tsc --emitDeclarationOnly --declaration`
- `stubs/**/*.stub` is copied into `build/` after compile
- Only files listed in `package.json#files` are published

## Formatting Rules
- Use 2-space indentation
- Use LF line endings
- Use UTF-8
- Trim trailing whitespace except where Markdown requires it
- Insert a final newline in files
- Let Prettier handle formatting; do not hand-format against it

## Imports
- Use ESM imports only
- Prefer static imports at the top of the file
- Keep imports minimal and remove unused imports
- Prefer named imports when the module exposes them
- For Node built-ins, prefer the `node:` prefix
- Follow the existing import style already used in nearby files

## TypeScript Guidelines
- Write TypeScript-first code; do not introduce plain CommonJS patterns
- Preserve compatibility with the package TS config extended from `@adonisjs/tsconfig`
- Prefer explicit exported types for public package APIs
- Avoid `any`; use concrete types, generics, or `unknown` with narrowing
- Run `npm run typecheck` after meaningful TS changes

## Naming Conventions
- Use `snake_case` for file and directory names; the README says this is the expected filesystem convention and ESLint enforces it
- Use clear, descriptive TypeScript identifiers
- Prefer PascalCase for classes and types
- Prefer camelCase for variables, parameters, and functions
- Keep test group names and test titles descriptive and behavior-focused

## Code Structure
- Keep the package entrypoints (`index.ts`, `configure.ts`) thin
- Place reusable implementation code in `src/`
- Keep providers in `providers/` and ensure exported providers are represented in package exports when needed
- Keep test bootstrapping in `bin/test.ts`; do not duplicate test runner setup in individual tests
- Keep changes minimal and consistent with the starter-kit layout unless the user requests otherwise

## Error Handling
- Fail fast on invalid inputs rather than hiding errors
- Prefer explicit error messages that help a package consumer understand what failed
- Do not swallow exceptions silently
- Preserve framework-native error behavior unless there is a clear reason to wrap it

## Testing Style
- Use Japa's `test.group` to organize related tests
- Keep tests focused on observable behavior
- Name test groups after the area under test
- Name individual tests after the expected behavior
- Use `quick:test` for iteration and `test` when verifying the full change

## Linting and Style Expectations
- ESLint config is `export default configPkg()` from `@adonisjs/eslint-config`
- Prettier config is inherited from `@adonisjs/prettier-config`
- Follow existing AdonisJS starter conventions instead of inventing local style exceptions
- Avoid introducing alternate formatting, alternate test frameworks, or alternate build tooling without user approval

## Practical Agent Checklist
- Read nearby code before editing
- Prefer the smallest correct change
- Run `npm run lint`
- Run `npm run typecheck` for TypeScript changes
- Run the narrowest relevant Japa command first
- Run broader verification before finishing when the change affects multiple surfaces
- If you add stubs or exports, verify the build still succeeds
