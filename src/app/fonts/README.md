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

## Costì product faces (full upstream files, not subset)

Montserrat (headings) and Inter (body) are used only in the product look (`data-brand="costi"`, see
`docs/plans/2026-11-13-costi-product-brand.md` §3.4). The files are the unmodified upstream files, renamed to the
`<family>-<weight>-normal.woff2` pattern. They are full-charset, so there is no latin/latin-ext split. Fetched 2026-11-13.

| File                          | Source                                                                                                | sha256                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `montserrat-600-normal.woff2` | `JulietaUla/Montserrat` tag `v7.222`, `fonts/webfonts/Montserrat-SemiBold.woff2` (font version 7.222) | `12e1a9890320276b7c7c6fe95ccf06b7619ded7644e5decc56ff2c7449145301` |
| `inter-400-normal.woff2`      | `rsms/inter` release `v4.1`, asset `Inter-4.1.zip`, `web/Inter-Regular.woff2` (font version 4.001)    | `e06f6b1bc553aaea4e4668023ed0ab0a147129c3107f511bc7d03d361b0ae085` |
| `inter-700-normal.woff2`      | `rsms/inter` release `v4.1`, asset `Inter-4.1.zip`, `web/Inter-Bold.woff2` (font version 4.001)       | `fa888127b6da015b65569f0351f3b5c391ad928904951f1c20e9f8462a8d95ea` |
| `OFL-Montserrat.txt`          | `JulietaUla/Montserrat` tag `v7.222`, `OFL.txt`                                                       | `41f82bb4d24b304f30f7136bc47abdd083782e4265c984160f5649d1e78ea49c` |
| `OFL-Inter.txt`               | `rsms/inter` release `v4.1`, asset `Inter-4.1.zip`, `LICENSE.txt`                                     | `262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a` |

The `Inter-4.1.zip` asset itself has sha256 `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`. The Montserrat
files came from `raw.githubusercontent.com` at the `v7.222` tag (the release has source archives only).

**Reserved Font Name check (2026-11-13), on the files shipped.** The font name tables (copyright, licence and licence URL
records, read from each woff2) and the licence files were checked.

- Montserrat 7.222: copyright "Copyright 2011 The Montserrat Project Authors (https://github.com/JulietaUla/Montserrat)", licence "SIL
  Open Font License, Version 1.1"; the licence file has no "with Reserved Font Name" line. **No Reserved Font Name declared.**
- Inter 4.001 (Regular and Bold): copyright "Copyright 2016 The Inter Project Authors", licence "SIL Open Font License, Version 1.1";
  the licence file has no "with Reserved Font Name" line. **No Reserved Font Name declared.** The name table does carry the trademark
  notice "Inter UI and Inter is a trademark of rsms", which is a trademark, not an RFN; the files are unmodified.

Both licence files only contain the licence's own definition of the term ("Reserved Font Name" refers to any names specified as such
after the copyright statement(s)), which names nothing.

To update: `npm pack @fontsource/<family>@<version>`, copy the same files and the `LICENSE`, update this table, and keep
`tests/lib/design/fonts.test.ts` green.
