# ts-wasms [![npm version](https://img.shields.io/npm/v/ts-wasms.svg?style=flat-square)](https://www.npmjs.com/package/ts-wasms)
Prebuilt WASM binaries and query files(`.scm`) for tree-sitter's language parsers.
You can find a list of supported languages [here](https://app.unpkg.com/ts-wasms/files/out)

## Installation
```bash
npm install ts-wasms
# or
pnpm add ts-wasms
# or
yarn add ts-wasms
# or
bun install ts-wasms
```

## Usage
A type-safe API is provided for accessing grammars and queries at runtime
```typescript
import { getWasmPath, getQueryPath } from "ts-wasms";

const wasmPath = getWasmPath("python");
const queryPath = getQueryPath("python", "highlights");
```

You can also import the assets directly via your bundler
```typescript
import wasmUrl from "ts-wasms/python/tree-sitter-python.wasm?url";
import wasmHighlights from "ts-wasms/python/highlights.scm?raw";
```

Each language directory includes a `tree-sitter-<lang>.wasm` file but may also include:
- `highlights.scm`
- `injections.scm`
- `locals.scm`
- `tags.scm`
- `folds.scm`
- `indents.scm`

```txt
python/
├── tree-sitter-python.wasm
├── highlights.scm
└── tags.scm
```

## Licenses
The licenses for the generated .wasm and .scm files belong to their respective upstream grammar authors and can be found on their github repos.

The code in this repository is licensed under MIT.
If you maintain an upstream grammar and have a problem with this licensing, please open an issue.
