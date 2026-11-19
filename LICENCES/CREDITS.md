# Credits and third-party notices

NorthKit is built on open-source software. Most of it is under permissive licences (MIT, MIT-0, Apache-2.0, BSD, ISC, PostgreSQL, 0BSD) whose notices travel with each package. This file covers the packages under other licences that NorthSpec approved with conditions (13 and 14 Nov 2026, the same as NorthCore WMS). `pnpm licences:check` enforces the conditions in CI. Full reasons are in [`docs/dependencies.md`](../docs/dependencies.md).

## Shipped with the product: data, with credit (CC-BY-4.0)

| Package | Licence | What it is | Credit |
| --- | --- | --- | --- |
| `caniuse-lite` | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Browser-support data used by Next.js (via browserslist). Data only, not modified. | Data from the Can I Use project, © Alexis Deveria, https://caniuse.com, licensed under CC BY 4.0. |

## Shipped with the product: font files only (SIL Open Font Licence 1.1)

Font files and the stylesheets that declare them; no code. Not modified. Served from the customer's own server: nothing is fetched from a font service.

| Package | Licence | What it is | Credit |
| --- | --- | --- | --- |
| `@fontsource/inter` | [SIL Open Font Licence 1.1](https://openfontlicense.org/open-font-license-official-text/) | The Inter typeface (weights 400, 500 and 600) for every product screen, and (400 and 600, Latin) embedded in report PDFs | Inter, Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter). Packaged by Fontsource (https://fontsource.org). Licensed under the SIL Open Font License, Version 1.1. |
| `@fontsource/space-grotesk` | [SIL Open Font Licence 1.1](https://openfontlicense.org/open-font-license-official-text/) | The Space Grotesk typeface (weights 500 and 600) for page titles, the wordmark and big figures | Space Grotesk, Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk). Packaged by Fontsource (https://fontsource.org). Licensed under the SIL Open Font License, Version 1.1. |

## Build and test tools only, not shipped (MPL-2.0, BlueOak-1.0.0)

Used while building or testing NorthKit. They are not part of the running product, and NorthSpec does not modify them.

| Package | Licence | What it is | Source |
| --- | --- | --- | --- |
| `lightningcss` and its platform binaries | [MPL-2.0](https://www.mozilla.org/MPL/2.0/) | CSS compiler used by the Next.js build | https://github.com/parcel-bundler/lightningcss |
| `axe-core`, `@axe-core/playwright` | [MPL-2.0](https://www.mozilla.org/MPL/2.0/) | Accessibility rules engine and its Playwright runner, used by the browser tests | https://github.com/dequelabs/axe-core |
| `minimatch`, `@isaacs/nonrecursive-glob-match` | [Blue Oak Model Licence 1.0.0](https://blueoakcouncil.org/license/1.0.0) | Glob matching used by ESLint | https://github.com/isaacs/minimatch |

## Brand

The NorthKit mark and app icons in `apps/web/public/` are made from the BrandCentre mark (`northkit/logo`), owned by Chris Ramsden trading as NorthSpec. The sign-in picture and the other illustrations are original SVG drawn in the design tokens.
