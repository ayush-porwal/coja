/**
 * App-chrome palettes ported from t3code (https://github.com/pingdotgg/t3code,
 * packages/shared/src/themePalettes.ts, MIT — © Ping Learning Services, Inc.);
 * palette values are copied verbatim for the roles coja uses. t3code's flagship
 * "T3 Chat" palette is renamed "Mulberry" here, as coja's default.
 *
 * The `syntax` blocks are coja's own: t3code's palettes stop at code background
 * / foreground, and these keyword/string/constant/comment ramps extend each
 * palette's accent hue into a readable highlighter theme (see themes/diffTheme.ts).
 *
 * Layout: one entry per palette with a `light` and a `dark` variant — the same
 * shape t3code uses (a theme plus its opposite-appearance variant).
 */

export type ThemeAppearance = 'light' | 'dark'

/** The chrome+code surface vocabulary coja renders from. */
export interface ThemeVariant {
  /** App background. */
  canvas: string
  /** Top bars and header strips. */
  chrome: string
  /** Raised list/card surfaces. */
  card: string
  /** Dialogs, popovers, menus. */
  overlay: string
  /** Side panels (file tree, AI chat). */
  panel: string
  /** Borders between panels. */
  panelEdge: string
  /** Row hover on panel surfaces. */
  hover: string
  /** Selected-row fill on panel surfaces. */
  active: string
  /** Control hover on chrome surfaces. */
  hoverAlt: string
  ink: string
  muted: string
  faint: string
  /** Hairline borders. */
  edge: string
  /** Input borders. */
  edgeStrong: string
  focus: string
  accent: string
  /** Text on top of `accent`. */
  accentInk: string
  /** Tinted accent wash behind accented text. */
  accentSoft: string
  ok: string
  okSoft: string
  danger: string
  dangerSoft: string
  caution: string
  cautionSoft: string
  /** Diff/code surface. */
  code: string
  codeInk: string
}

/** Highlighter token colors for `@pierre/diffs` (see themes/diffTheme.ts). */
export interface SyntaxVariant {
  keyword: string
  fn: string
  string: string
  constant: string
  comment: string
  punct: string
}

export interface CojaPalette {
  id: string
  label: string
  /** The appearance the palette was designed around (t3code's own base). */
  native: ThemeAppearance
  light: ThemeVariant
  dark: ThemeVariant
  syntax: Record<ThemeAppearance, SyntaxVariant>
}

export const PALETTES: CojaPalette[] = [
  {
    id: 'mulberry',
    label: 'Mulberry',
    native: 'light',
    light: {
      canvas: 'oklch(0.982446 0.010114 325.653)',
      chrome: 'oklch(0.982446 0.010114 325.653)',
      card: 'oklch(0.988235 0.005049 325.615)',
      overlay: 'oklch(1 0 0)',
      panel: 'oklch(0.928886 0.031178 322.592)',
      panelEdge: 'oklch(0.938313 0.002552 48.717)',
      hover: 'oklch(0.978851 0.001321 106.424)',
      active: 'oklch(0.978851 0.001321 106.424)',
      hoverAlt: 'oklch(0.884525 0.041658 337.177)',
      ink: 'oklch(0.325698 0.116116 325.037)',
      muted: 'oklch(0.494754 0.190937 354.544)',
      faint: 'oklch(0.549927 0.090215 323.149)',
      edge: 'oklch(0.923531 0.021247 328.096)',
      edgeStrong: 'oklch(0.851713 0.055822 336.6)',
      focus: 'oklch(0.591646 0.217985 0.584)',
      accent: 'oklch(0.591646 0.217985 0.584)',
      accentInk: 'oklch(1 0 0)',
      accentSoft: 'oklch(0.939552 0.024286 321.664)',
      // Deeper than the other lights': Mulberry's code ink is the lightest of
      // the five (t3code's own value), so its green must go darker to keep
      // 4.5:1 over the addition fill (contrast.test.ts enforces this).
      ok: 'oklch(0.44 0.11 150)',
      okSoft: 'oklch(0.945 0.05 150)',
      danger: 'oklch(0.627117 0.248974 7.734)',
      dangerSoft: 'oklch(0.942787 0.032076 344.963)',
      caution: 'oklch(0.76859 0.164659 70.08)',
      cautionSoft: 'oklch(0.962901 0.015297 48.56)',
      code: 'oklch(0.953855 0.019695 315.668)',
      // Darkened from t3code's 0.445: Mulberry is the only palette whose light
      // code ink is mid-lightness, and on its 50% addition fill that measured
      // 3.7:1 (below WCAG AA for 12.5px text). 0.32 clears 4.5 with margin —
      // enforced per theme in contrast.test.ts.
      codeInk: 'oklch(0.32 0.10 307.026)',
    },
    dark: {
      canvas: 'oklch(0.22813 0.020366 307.469)',
      chrome: 'oklch(0.22813 0.020366 307.469)',
      card: 'oklch(0.279864 0.021572 309.532)',
      overlay: 'oklch(0.154761 0.01316 338.901)',
      panel: 'oklch(0.185778 0.019368 322.159)',
      panelEdge: 'oklch(0.269132 0.030766 351.067)',
      hover: 'oklch(0.23366 0.026081 338.196)',
      active: 'oklch(0.23366 0.026081 338.196)',
      hoverAlt: 'oklch(0.364912 0.050794 308.491)',
      ink: 'oklch(0.980735 0.004092 301.426)',
      muted: 'oklch(0.880303 0.03077 342.696)',
      faint: 'oklch(0.657087 0.028226 307.985)',
      edge: 'oklch(0.266943 0.015262 302.425)',
      edgeStrong: 'oklch(0.266817 0.02897 344.461)',
      focus: 'oklch(0.591646 0.217985 0.584)',
      accent: 'oklch(0.460685 0.185347 4.099)',
      accentInk: 'oklch(0.901233 0.057189 343.694)',
      accentSoft: 'oklch(0.364912 0.050794 308.491)',
      ok: 'oklch(0.75 0.13 150)',
      okSoft: 'oklch(0.32 0.06 150)',
      danger: 'oklch(0.65 0.19 15)',
      dangerSoft: 'oklch(0.259022 0.04799 340.062)',
      caution: 'oklch(0.76859 0.164659 70.08)',
      cautionSoft: 'oklch(0.321706 0.036256 60.806)',
      code: 'oklch(0.22813 0.020366 307.469)',
      codeInk: 'oklch(0.848703 0.064239 306.645)',
    },
    syntax: {
      light: {
        keyword: 'oklch(0.52 0.17 4)',
        fn: 'oklch(0.55 0.16 340)',
        string: 'oklch(0.50 0.12 150)',
        constant: 'oklch(0.52 0.12 65)',
        comment: 'oklch(0.55 0.05 325)',
        punct: 'oklch(0.48 0.06 325)',
      },
      dark: {
        keyword: 'oklch(0.76 0.14 10)',
        fn: 'oklch(0.78 0.13 345)',
        string: 'oklch(0.75 0.11 150)',
        constant: 'oklch(0.78 0.11 75)',
        comment: 'oklch(0.63 0.04 310)',
        punct: 'oklch(0.61 0.03 310)',
      },
    },
  },
  {
    id: 'grove',
    label: 'Grove',
    native: 'light',
    light: {
      canvas: 'oklch(0.972369 0.005497 157.15)',
      chrome: 'oklch(0.972369 0.005497 157.15)',
      card: 'oklch(0.949276 0.004496 159.002)',
      overlay: 'oklch(0.932695 0.003778 160.944)',
      panel: 'oklch(0.936464 0.014601 163.554)',
      panelEdge: 'oklch(0.860274 0.010287 168.339)',
      hover: 'oklch(0.886676 0.027374 164.983)',
      active: 'oklch(0.836654 0.040284 165.149)',
      hoverAlt: 'oklch(0.909438 0.021521 164.612)',
      ink: 'oklch(0.222003 0.03479 328.979)',
      muted: 'oklch(0.540472 0.014944 326.176)',
      faint: 'oklch(0.529681 0.01551 326.299)',
      edge: 'oklch(0.864831 0.01312 167.255)',
      edgeStrong: 'oklch(0.829746 0.016084 168.234)',
      focus: 'oklch(0.523295 0.112292 158.089)',
      accent: 'oklch(0.523295 0.112292 158.089)',
      accentInk: 'oklch(0.990339 0.008411 325.64)',
      accentSoft: 'oklch(0.909438 0.021521 164.612)',
      ok: 'oklch(0.55 0.13 150)',
      okSoft: 'oklch(0.93 0.05 150)',
      danger: 'oklch(0.637823 0.237287 25.436)',
      dangerSoft: 'oklch(0.936968 0.014243 26.295)',
      caution: 'oklch(0.772406 0.172798 65.367)',
      cautionSoft: 'oklch(0.953175 0.02009 93.379)',
      code: 'oklch(0.955888 0.004783 158.391)',
      codeInk: 'oklch(0.222003 0.03479 328.979)',
    },
    dark: {
      canvas: 'oklch(0.260865 0.02152 162.75)',
      chrome: 'oklch(0.260865 0.02152 162.75)',
      card: 'oklch(0.363192 0.016572 165.32)',
      overlay: 'oklch(0.411828 0.014378 166.627)',
      panel: 'oklch(0.309925 0.032827 160.944)',
      panelEdge: 'oklch(0.569253 0.015933 167.062)',
      hover: 'oklch(0.374959 0.047124 159.686)',
      active: 'oklch(0.437466 0.060406 158.958)',
      hoverAlt: 'oklch(0.437021 0.060312 158.962)',
      ink: 'oklch(0.990339 0.008411 325.64)',
      muted: 'oklch(0.666747 0.004239 187.292)',
      faint: 'oklch(0.739243 0.002222 223.225)',
      edge: 'oklch(0.457475 0.044046 160.971)',
      edgeStrong: 'oklch(0.519849 0.049896 160.863)',
      focus: 'oklch(0.796228 0.133058 157.319)',
      accent: 'oklch(0.796228 0.133058 157.319)',
      accentInk: 'oklch(0.222003 0.03479 328.979)',
      accentSoft: 'oklch(0.437021 0.060312 158.962)',
      ok: 'oklch(0.78 0.13 150)',
      okSoft: 'oklch(0.34 0.06 150)',
      danger: 'oklch(0.655108 0.221148 23.473)',
      dangerSoft: 'oklch(0.312773 0.02923 32.121)',
      caution: 'oklch(0.772406 0.172798 65.367)',
      cautionSoft: 'oklch(0.345524 0.046882 99.736)',
      code: 'oklch(0.312979 0.018942 164.082)',
      codeInk: 'oklch(0.990339 0.008411 325.64)',
    },
    syntax: {
      light: {
        keyword: 'oklch(0.48 0.11 158)',
        fn: 'oklch(0.50 0.12 190)',
        string: 'oklch(0.48 0.11 265)',
        constant: 'oklch(0.50 0.12 85)',
        comment: 'oklch(0.55 0.03 165)',
        punct: 'oklch(0.46 0.03 165)',
      },
      dark: {
        keyword: 'oklch(0.79 0.12 158)',
        fn: 'oklch(0.81 0.11 190)',
        string: 'oklch(0.77 0.09 265)',
        constant: 'oklch(0.80 0.11 90)',
        comment: 'oklch(0.64 0.02 170)',
        punct: 'oklch(0.62 0.02 170)',
      },
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    native: 'light',
    light: {
      canvas: 'oklch(0.974199 0.002856 241.597)',
      chrome: 'oklch(0.974199 0.002856 241.597)',
      card: 'oklch(0.951058 0.002962 258.339)',
      overlay: 'oklch(0.934442 0.003181 269.1)',
      panel: 'oklch(0.939254 0.01193 241.729)',
      panelEdge: 'oklch(0.862823 0.011384 256.926)',
      hover: 'oklch(0.890798 0.024681 241.933)',
      active: 'oklch(0.842113 0.037689 242.174)',
      hoverAlt: 'oklch(0.91295 0.018827 241.836)',
      ink: 'oklch(0.222003 0.03479 328.979)',
      muted: 'oklch(0.541555 0.017468 323.531)',
      faint: 'oklch(0.530733 0.01795 323.79)',
      edge: 'oklch(0.867646 0.013482 252.362)',
      edgeStrong: 'oklch(0.832939 0.017389 252.598)',
      focus: 'oklch(0.536684 0.120219 247.01)',
      accent: 'oklch(0.536684 0.120219 247.01)',
      accentInk: 'oklch(0.990339 0.008411 325.64)',
      accentSoft: 'oklch(0.91295 0.018827 241.836)',
      ok: 'oklch(0.55 0.13 150)',
      okSoft: 'oklch(0.93 0.05 150)',
      danger: 'oklch(0.637823 0.237287 25.436)',
      dangerSoft: 'oklch(0.938747 0.016377 7.186)',
      caution: 'oklch(0.772406 0.172798 65.367)',
      cautionSoft: 'oklch(0.954846 0.016009 81.731)',
      code: 'oklch(0.957684 0.002906 253.68)',
      codeInk: 'oklch(0.222003 0.03479 328.979)',
    },
    dark: {
      canvas: 'oklch(0.242641 0.024125 250.573)',
      chrome: 'oklch(0.242641 0.024125 250.573)',
      card: 'oklch(0.348439 0.019942 253.696)',
      overlay: 'oklch(0.398517 0.018232 255.72)',
      panel: 'oklch(0.290387 0.032043 247.274)',
      panelEdge: 'oklch(0.55859 0.019001 256.223)',
      hover: 'oklch(0.353381 0.042285 245.043)',
      active: 'oklch(0.413744 0.051943 243.848)',
      hoverAlt: 'oklch(0.413315 0.051874 243.855)',
      ink: 'oklch(0.990339 0.008411 325.64)',
      muted: 'oklch(0.652227 0.01149 273.31)',
      faint: 'oklch(0.721641 0.010192 281.271)',
      edge: 'oklch(0.438653 0.039496 245.44)',
      edgeStrong: 'oklch(0.500905 0.043574 244.781)',
      focus: 'oklch(0.758933 0.105833 241.548)',
      accent: 'oklch(0.758933 0.105833 241.548)',
      accentInk: 'oklch(0.222003 0.03479 328.979)',
      accentSoft: 'oklch(0.413315 0.051874 243.855)',
      ok: 'oklch(0.78 0.13 150)',
      okSoft: 'oklch(0.34 0.06 150)',
      danger: 'oklch(0.655108 0.221148 23.473)',
      dangerSoft: 'oklch(0.298933 0.036443 350.094)',
      caution: 'oklch(0.772406 0.172798 65.367)',
      cautionSoft: 'oklch(0.329449 0.028712 84.495)',
      code: 'oklch(0.29661 0.021883 251.968)',
      codeInk: 'oklch(0.990339 0.008411 325.64)',
    },
    syntax: {
      light: {
        keyword: 'oklch(0.50 0.13 250)',
        fn: 'oklch(0.52 0.13 222)',
        string: 'oklch(0.48 0.11 155)',
        constant: 'oklch(0.50 0.12 65)',
        comment: 'oklch(0.55 0.04 250)',
        punct: 'oklch(0.48 0.04 250)',
      },
      dark: {
        keyword: 'oklch(0.78 0.11 245)',
        fn: 'oklch(0.80 0.11 218)',
        string: 'oklch(0.76 0.10 150)',
        constant: 'oklch(0.79 0.11 75)',
        comment: 'oklch(0.63 0.03 250)',
        punct: 'oklch(0.61 0.03 250)',
      },
    },
  },
  {
    id: 'ember',
    label: 'Ember',
    native: 'light',
    light: {
      canvas: 'oklch(0.976527 0.002685 60.725)',
      chrome: 'oklch(0.976527 0.002685 60.725)',
      card: 'oklch(0.953321 0.002701 42.266)',
      overlay: 'oklch(0.936659 0.002879 29.96)',
      panel: 'oklch(0.942267 0.01151 50.785)',
      panelEdge: 'oklch(0.865593 0.011154 35.246)',
      hover: 'oklch(0.894819 0.024151 49.073)',
      active: 'oklch(0.84723 0.037292 48.403)',
      hoverAlt: 'oklch(0.916502 0.01832 49.597)',
      ink: 'oklch(0.222003 0.03479 328.979)',
      muted: 'oklch(0.543023 0.017316 331.964)',
      faint: 'oklch(0.532339 0.017796 331.748)',
      edge: 'oklch(0.870631 0.013204 39.431)',
      edgeStrong: 'oklch(0.836213 0.017153 38.661)',
      focus: 'oklch(0.552831 0.129438 44.656)',
      accent: 'oklch(0.552831 0.129438 44.656)',
      accentInk: 'oklch(0.990339 0.008411 325.64)',
      accentSoft: 'oklch(0.916502 0.01832 49.597)',
      ok: 'oklch(0.55 0.13 150)',
      okSoft: 'oklch(0.93 0.05 150)',
      danger: 'oklch(0.637823 0.237287 25.436)',
      dangerSoft: 'oklch(0.941094 0.019938 19.375)',
      caution: 'oklch(0.772406 0.172798 65.367)',
      cautionSoft: 'oklch(0.957148 0.020843 76.702)',
      code: 'oklch(0.959965 0.002668 47.512)',
      codeInk: 'oklch(0.222003 0.03479 328.979)',
    },
    dark: {
      canvas: 'oklch(0.245899 0.019144 42.044)',
      chrome: 'oklch(0.245899 0.019144 42.044)',
      card: 'oklch(0.351262 0.01565 37.592)',
      overlay: 'oklch(0.401111 0.014308 34.896)',
      panel: 'oklch(0.293349 0.029554 46.882)',
      panelEdge: 'oklch(0.560372 0.016998 36.179)',
      hover: 'oklch(0.356163 0.042933 49.385)',
      active: 'oklch(0.416477 0.055442 50.489)',
      hoverAlt: 'oklch(0.416048 0.055354 50.484)',
      ink: 'oklch(0.990339 0.008411 325.64)',
      muted: 'oklch(0.654017 0.009505 13.287)',
      faint: 'oklch(0.723533 0.008741 4.515)',
      edge: 'oklch(0.44099 0.040202 48.807)',
      edgeStrong: 'oklch(0.503003 0.045721 49.44)',
      focus: 'oklch(0.762174 0.124117 52.082)',
      accent: 'oklch(0.762174 0.124117 52.082)',
      accentInk: 'oklch(0.222003 0.03479 328.979)',
      accentSoft: 'oklch(0.416048 0.055354 50.484)',
      ok: 'oklch(0.78 0.13 150)',
      okSoft: 'oklch(0.34 0.06 150)',
      danger: 'oklch(0.655108 0.221148 23.473)',
      dangerSoft: 'oklch(0.310955 0.059624 24.334)',
      caution: 'oklch(0.772406 0.172798 65.367)',
      cautionSoft: 'oklch(0.339137 0.055638 66.911)',
      code: 'oklch(0.299662 0.017229 39.973)',
      codeInk: 'oklch(0.990339 0.008411 325.64)',
    },
    syntax: {
      light: {
        keyword: 'oklch(0.50 0.13 40)',
        fn: 'oklch(0.52 0.14 22)',
        string: 'oklch(0.48 0.11 155)',
        constant: 'oklch(0.50 0.12 300)',
        comment: 'oklch(0.55 0.04 50)',
        punct: 'oklch(0.48 0.04 50)',
      },
      dark: {
        keyword: 'oklch(0.79 0.13 50)',
        fn: 'oklch(0.81 0.12 28)',
        string: 'oklch(0.76 0.10 150)',
        constant: 'oklch(0.77 0.11 310)',
        comment: 'oklch(0.64 0.03 45)',
        punct: 'oklch(0.62 0.03 45)',
      },
    },
  },
  {
    id: 'iris',
    label: 'Iris',
    native: 'light',
    light: {
      canvas: 'oklch(0.976531 0.003855 303.226)',
      chrome: 'oklch(0.976531 0.003855 303.226)',
      card: 'oklch(0.953326 0.004536 307.676)',
      overlay: 'oklch(0.936665 0.005041 310.132)',
      panel: 'oklch(0.941387 0.014687 300.474)',
      panelEdge: 'oklch(0.864805 0.015938 305.371)',
      hover: 'oklch(0.892522 0.030022 299.704)',
      active: 'oklch(0.843236 0.045818 299.198)',
      hoverAlt: 'oklch(0.914882 0.022965 299.986)',
      ink: 'oklch(0.222003 0.03479 328.979)',
      muted: 'oklch(0.543042 0.018894 325.652)',
      faint: 'oklch(0.532177 0.019333 325.784)',
      edge: 'oklch(0.869608 0.018226 303.859)',
      edgeStrong: 'oklch(0.834773 0.023405 303.676)',
      focus: 'oklch(0.525348 0.15373 294.176)',
      accent: 'oklch(0.525348 0.15373 294.176)',
      accentInk: 'oklch(0.990339 0.008411 325.64)',
      accentSoft: 'oklch(0.914882 0.022965 299.986)',
      ok: 'oklch(0.55 0.13 150)',
      okSoft: 'oklch(0.93 0.05 150)',
      danger: 'oklch(0.637823 0.237287 25.436)',
      dangerSoft: 'oklch(0.941043 0.019582 4.235)',
      caution: 'oklch(0.772406 0.172798 65.367)',
      cautionSoft: 'oklch(0.957054 0.016197 69.932)',
      code: 'oklch(0.95997 0.004338 306.542)',
      codeInk: 'oklch(0.222003 0.03479 328.979)',
    },
    dark: {
      canvas: 'oklch(0.225975 0.031062 293.741)',
      chrome: 'oklch(0.225975 0.031062 293.741)',
      card: 'oklch(0.335291 0.026008 296.394)',
      overlay: 'oklch(0.386739 0.024023 297.509)',
      panel: 'oklch(0.266743 0.044689 294.138)',
      panelEdge: 'oklch(0.545895 0.027522 299.871)',
      hover: 'oklch(0.320808 0.062152 294.23)',
      active: 'oklch(0.372806 0.078525 294.203)',
      hoverAlt: 'oklch(0.372436 0.07841 294.204)',
      ink: 'oklch(0.990339 0.008411 325.64)',
      muted: 'oklch(0.640465 0.016197 304.171)',
      faint: 'oklch(0.706249 0.014508 306.607)',
      edge: 'oklch(0.40874 0.058536 295.893)',
      edgeStrong: 'oklch(0.46756 0.065775 296.265)',
      focus: 'oklch(0.671712 0.169136 293.929)',
      accent: 'oklch(0.671712 0.169136 293.929)',
      accentInk: 'oklch(0.222003 0.03479 328.979)',
      accentSoft: 'oklch(0.372436 0.07841 294.204)',
      ok: 'oklch(0.78 0.13 150)',
      okSoft: 'oklch(0.34 0.06 150)',
      danger: 'oklch(0.655108 0.221148 23.473)',
      dangerSoft: 'oklch(0.291658 0.054707 352.238)',
      caution: 'oklch(0.772406 0.172798 65.367)',
      cautionSoft: 'oklch(0.318952 0.033845 51.646)',
      code: 'oklch(0.281873 0.028308 295.193)',
      codeInk: 'oklch(0.990339 0.008411 325.64)',
    },
    syntax: {
      light: {
        keyword: 'oklch(0.50 0.14 294)',
        fn: 'oklch(0.52 0.13 325)',
        string: 'oklch(0.48 0.11 155)',
        constant: 'oklch(0.52 0.12 70)',
        comment: 'oklch(0.55 0.04 295)',
        punct: 'oklch(0.48 0.04 295)',
      },
      dark: {
        keyword: 'oklch(0.76 0.13 294)',
        fn: 'oklch(0.78 0.12 325)',
        string: 'oklch(0.76 0.10 150)',
        constant: 'oklch(0.79 0.11 80)',
        comment: 'oklch(0.64 0.03 295)',
        punct: 'oklch(0.62 0.03 295)',
      },
    },
  },
]
