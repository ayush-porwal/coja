# Coja CJ assets

Approved direction: the C connects to the start of a smooth J that descends into an open hanging hook. Preserve the supplied geometry, dot, stroke weight, and layering.

## Required theme switching

**Both logos and Lottie animations must change with the user's selected palette AND resolved light/dark appearance, including the favicon and boot loader.** Use the active Coja preference, not only the operating system theme.

The complete theme-specific set is indexed by `web/public/brand/coja/manifest.json`:

| Palette | Appearances | SVG icons | Lottie animations |
| --- | --- | --- | --- |
| Mulberry | Light + dark | 2 | 8 |
| Grove | Light + dark | 2 | 8 |
| Ocean | Light + dark | 2 | 8 |
| Ember | Light + dark | 2 | 8 |
| Iris | Light + dark | 2 | 8 |

There are **10 matching SVGs and 40 Lottie animations**. Each appearance includes huge, large, medium, and small. Canonical paths:

- `/brand/coja/themes/{palette}/{appearance}/cj.svg`
- `/brand/coja/themes/{palette}/{appearance}/cj-{size}.json`

Select `manifest.themes[palette.id][appearance].icon` and `.loaders[size]` using `useTheme()`. For system mode resolve to light/dark with the existing registry; update when system appearance changes. At startup use the persisted preference through the existing registry helpers. Change assets immediately when the user switches palettes or appearances. Test every combination and keep favicon, static marks, and loaders synchronized.

Colors come from each variant's `ink` (C) and `accent` (J/dot) in `web/src/themes/palettes.ts`, converted from OKLCH to sRGB with channel clipping for out-of-gamut values. The manifest records original tokens and hex colors. Geometry, timing, and reveal matte are unchanged. The original generic SVGs and `lottie/` files below remain reference assets; **use the theme-specific matrix for integration**. Regenerate the matrix if palette definitions change.

## Original reference assets

Assets live in `web/public/brand/coja/` and are available under `/brand/coja/` when served by Vite:

- `cj-light.svg` and `cj-dark.svg`: transparent static marks.
- `cj-themeable.svg`: same geometry with `--coja-logo-ink` and `--coja-logo-accent`, falling back to `currentColor`. Inline SVG is required to inherit app CSS; an external SVG loaded through `<img>` does not inherit those properties.
- `lottie/cj-{huge,large,medium,small}-{light,dark}.json`: eight transparent vector animations. Nominal square sizes are 360, 160, 64, and 24 pixels; all scale independently of display density.

Each animation runs for 336 frames at 60 fps (5.6 seconds): C, J, dot, hold, fade. Configure looping in the player. Frame 260 is the completed mark for reduced-motion/static fallback. Use a player supporting alpha track mattes and trim paths, such as lottie-web's SVG renderer. JSON parsing and copied-file integrity have been checked; integration must verify rendering in the actual app.

Light defaults: ink `#302334`, accent `#a03d75`. Dark defaults: ink `#f5eef7`, accent `#d58ab8`. These are legacy preview colors; the canonical theme-specific assets above already contain the actual palette colors. Lottie does not inherit CSS colors: clone animation data and update color properties on `C · ink`, `J · accent`, and `Dot · accent`; keep the white `C · handwriting reveal` matte unchanged. Preserve keyframes, path data, and layer ordering. Resolve CSS/OKLCH values to the normalized sRGB arrays Lottie expects.

The huge asset's canvas does not center itself on the page; its container must provide responsive centering. Provide accessible loading status independently of decorative animation. No application code or dependency was changed when saving these assets.

See `glm-flash-5.3-prompt.md` for the implementation brief.

## Typography integration scope

The integration prompt also requires bundled **IBM Plex Sans** for UI and **Maple Mono NF** for code, including upstream licenses and release provenance. Font files have not been bundled by this documentation update; the implementing agent must inspect existing assets and obtain any missing official webfonts.

The existing Settings page must gain typography preferences: separate UI/code families and sizes, code line height and ligatures, live preview, persistence, and reset. Preferences must apply immediately and remain independent of theme changes. See steps 7–10 of `glm-flash-5.3-prompt.md` for the full requirements and verification.
