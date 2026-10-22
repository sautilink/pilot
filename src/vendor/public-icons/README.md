# Router icon package used by Pilot

The browser runtime, adapter, stylesheet, original manifest, and license files in
this directory are byte-for-byte copies from the SautiLink Router repository:

- Repository: https://github.com/sautilink/router
- Git tree SHA: `48a687b7d0e34155e834950213f4af4ff6a6bf45`
- Package: `@animateicons/vanilla` 0.1.0, with Router's supplemental Lucide icons
  and SautiLink justice-scale drawing.
- Complete catalog: 89 icons.

`PROVENANCE.json` records the SHA-256 hash of each copied file. Router's original
`manifest.json` is retained without alteration. Its `runtimeSha256` field differs
from the delivered `icons.js`; the actual copied bundle's SHA-256 is
`c007298f07c3cf860fe4d050250517cd5fef075276c800fddb83f2d91c14a545`.
Pilot uses the delivered bundle and catalog rather than rewriting that historical
manifest value.

## Generated Worker modules

Run `node scripts/build-public-icons.mjs` from the repository root after an
intentional vendor update. It generates:

- `assets.generated.js`: browser assets as inert strings, their content types,
  byte lengths, hashes, and a shared content-derived cache version.
- `static.generated.js`: all 89 normal-state SVGs, rendered by the exact browser
  runtime in an isolated build-time VM with a minimal SVG DOM.

The generator checks the package version and catalog against the original
manifest, accepts only reviewed SVG elements and attributes, and preserves the
runtime's grouping, paths, and normal-state styles. Importing either generated
module in a Worker does not execute the browser runtime and requires no DOM.
No third-party CDN or font is needed.

`src/public-icons.js` supplies static inline icons, public same-origin assets,
and semantic aliases. Every inline icon is visible before JavaScript runs. Pages
opt into Router's exact adapter with `body[data-public-icons]`; it animates visible
controls, enhances new DOM nodes, and settles for reduced motion, background
tabs, offscreen icons, and page teardown. The static drawing remains available
when scripts fail or motion is reduced.

The copied license and notice files are also served under
`/assets/public-icons/` alongside the browser runtime. Their attribution and
license terms must remain with future copies.
