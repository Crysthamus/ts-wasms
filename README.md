# tree-sitter-wasm [![npm version](https://img.shields.io/npm/v/tree-sitter-wasm.svg?style=flat-square)](https://www.npmjs.com/package/tree-sitter-wasm)
Prebuilt WASM binaries and query files(`.scm`) for tree-sitter's language parsers.
You can find a list of supported languages [here](https://app.unpkg.com/tree-sitter-wasm/files/out)

## Installation
```bash
npm install tree-sitter-wasm
# or
pnpm add tree-sitter-wasm
# or
yarn add tree-sitter-wasm
# or
bun install tree-sitter-wasm
```

## Usage
A type-safe API is provided for accessing grammars and queries at runtime
```typescript
import { getWasmPath, getQueryPath } from "tree-sitter-wasm";

const wasmPath = getWasmPath("python");
const queryPath = getQueryPath("python", "highlights");
const pythonQueries = getAvailableQueries("python");
```

You can also import the assets directly via your bundler
```typescript
import wasmUrl from "tree-sitter-wasm/python/tree-sitter-python.wasm?url";
import wasmHighlights from "tree-sitter-wasm/python/highlights.scm?raw";

// This JSON object acts as table of content for all available languages
// and their queries.
import manifest from "tree-sitter-wasm/manifest.json"
```

Each language directory includes a `tree-sitter-<lang>.wasm` file but may also include:
- `highlights.scm`
- `injections.scm`
- `locals.scm`
- `tags.scm`
- `folds.scm`
- `indents.scm`
Certain languages also contain special queries like: `nova-symbols`, please refer to the manifest.json or to the out dir in unpkg. 

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
