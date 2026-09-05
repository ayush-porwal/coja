# Maple Mono NF

- Source: https://github.com/subframe7536/maple-font (official upstream releases)
- Release: v7.9 (`MapleMono-NF.zip`)
- Files: `MapleMono-NF-{Regular,Italic,Medium,MediumItalic,SemiBold,SemiBoldItalic,Bold,BoldItalic}.ttf`
- Conversion: subset to WOFF2 with fonttools (`pyftsubset`), keeping the Nerd
  Fonts private-use area (U+E000-F8FF), symbol ranges, and default programming
  ligatures (`--layout-features='*'`). NF variant used unmodified — not plain Maple Mono.
- License: SIL Open Font License 1.1 (see LICENSE.txt)

Bundled locally; no CDN requests. Served for the default code font
(Maple Mono NF) declared in `web/src/index.css`.
