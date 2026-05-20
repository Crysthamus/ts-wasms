# ts-wasms
Prebuilt WASM binaries for tree-sitter's language parsers.
You can find a list of supported packages [here](https://app.unpkg.com/ts-wasms/files/out)

## Installation
```bash
pnpm add ts-wasms
```

## Usage
```ts
import pythonWasm from "ts-wasms/out/python/tree-sitter-python.wasm"
import pythonHighlights from "ts-wasms/out/python/highlights.scm"
```

Each language directory includes a `tree-sitter-<lang>.wasm` file but may also include:
- `highlights.scm`
- `injections.scm`
- `locals.scm`
- `tags.scm`
- `folds.scm`
- `indents.scm`

```txt
out/python/
├── tree-sitter-python.wasm
├── highlights.scm
└── tags.scm
```

## Licenses
Licenses belong to their respective upstream grammar authors, however this repo is MIT licensed.
(If you have a problem with this licensing, please open an issue.)
