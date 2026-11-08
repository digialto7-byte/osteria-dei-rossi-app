# Brand fonts (self-hosted)

These woff2 files are loaded by `next/font/local` in `src/app/layout.tsx`. They are committed so the build never downloads
fonts and the browser never contacts Google (GDPR). Each face's licence is next to it (SIL Open Font License 1.1); neither
font declares a Reserved Font Name, and the files are unmodified.

| File                                     | Source                                   | sha256                                                             |
| ---------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| `bodoni-moda-latin-600-normal.woff2`     | `@fontsource/bodoni-moda@5.3.0` `files/` | `a4975772d313f22af5758888ce83dad5001e9a3afb9cf8bde805ad1c5caeaacc` |
| `bodoni-moda-latin-ext-600-normal.woff2` | `@fontsource/bodoni-moda@5.3.0` `files/` | `b27be6e9d86b603daf460787078508b2c3c658842984fcbf8b2129fed795456e` |
| `figtree-latin-400-normal.woff2`         | `@fontsource/figtree@5.3.0` `files/`     | `8f98dd642986f1fa39c45b89665a57372897c235b36028e0e4a136e43dc5f8ab` |
| `figtree-latin-700-normal.woff2`         | `@fontsource/figtree@5.3.0` `files/`     | `7ec4f08d09f91d349917dd6592f6aaae66d8fe1bbd58fa24707961e79236616e` |
| `figtree-latin-ext-400-normal.woff2`     | `@fontsource/figtree@5.3.0` `files/`     | `3f58126100ed4da09c54adcfb8fa9f642be69101d1e18dc4c0a5489ee9b904c5` |
| `figtree-latin-ext-700-normal.woff2`     | `@fontsource/figtree@5.3.0` `files/`     | `b3252ef48dfbfc51b2e7eecb4de8414dec694c4c83a16ef7afd319796235ef72` |

`OFL-BodoniModa.txt` and `OFL-Figtree.txt` are the packages' `LICENSE` files, copied as they are.

To update: `npm pack @fontsource/<family>@<version>`, copy the same files and the `LICENSE`, update this table, and keep
`tests/lib/design/fonts.test.ts` green.
