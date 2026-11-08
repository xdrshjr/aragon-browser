# Icon design brief — aragon-browser

The brief lives in a file so it can be argued with, not buried in a script.
`scripts/gen-icons.mjs` splices `SYSTEM` + one `MARK` per candidate and hands the
result to Codex's built-in GPT image tool.

The shipping icon is `build/icon.png` — the blue glass swirl (candidate 08). This
file records how it was chosen and how to make another one.

## What went wrong, five times

**Attempt 1** used words like *glass*, *crystal*, *glossy highlight*, *faceted*
and got gem renders with specular highlights and a purple mesh gradient.

**Attempt 2** banned those words but replaced them with absolute pixel
measurements ("86-unit strokes", "diameter 470 units") and got mechanical clip
art that read as generic icon-pack filler.

**Attempt 3** named OpenAI, Anthropic, Supabase, Figma and Linear as the
reference bar. The model did the most literal thing possible: it drew OpenAI's
knot — near enough to be a trademark problem.

**Attempt 4** fixed the shapes but kept a dark rounded plate behind a thin-line
mark, which is an icon-pack glyph, not a product icon.

**Attempt 5** dropped the plate and went bold, but the model kept painting white
blotches inside large flat fills, and left dark squares behind the material
renders.

Six rules follow, and they are the whole point of this file:

1. **Never name a material you do not want.** *Glass*, *crystal*, *metal*, *gloss*
   are read as invitations. (Some of them are wanted in a material treatment —
   then say so, and say where the sheen may shift.)
2. **Never name a brand whose quality you want.** A brand name is read as a shape
   request. Describe the *property* instead.
3. **Ratios beat pixels.** "One fifth of the form's height" survives resampling;
   "86 units" is noise the model cannot measure.
4. **A product icon names a product object.** Window, tab, page, globe, cursor.
   Abstract geometry (crown, aperture, arc) reads as a symbol exercise and can
   never say "browser".
5. **No plate.** The form itself fills the canvas. A dark rounded tile behind a
   symbol is what makes an icon look like a generic pack.
6. **Flat geometry is cheaper to draw in code than to prompt.** The model is
   unreliable inside large flat fills; a deterministic renderer is not. Candidates
   02, 04 and 06 are drawn by `scripts/draw-flat-icons.mjs` and
   `scripts/draw-06-stack-pages.mjs` for exactly this reason.

## The quality bar, described without naming anyone

What separates a designed mark from generated filler:

| Property | Concretely |
|---|---|
| Boldness | Thick, mostly solid masses; thinnest stroke at least 1/5 of the height. |
| One idea | The form says one thing. Removing any part breaks it. |
| Legible at 16 px | The silhouette alone identifies it. |
| Survives any background | White/pale forms carry a defined edge so they do not vanish. |
| Clean surface | One even tone or one smooth gradient. No stray patches. |
| No clutter | No text, no second icon, no grid, no watermark. |

## Locked palette

Identical for all candidates, so the set is one brand. Blue family only:

- **Ink** `#0B1220`
- **Azure** `#2563EB`
- **Light azure** `#60A5FA`
- **White** `#FFFFFF`

Explicitly excluded: purple, magenta, pink, red, orange, gold, green, teal.

## The ten concepts

| id | concept | finish |
|---|---|---|
| 01 | Azure window + white cursor arrow | flat |
| 02 | Azure disc, white chevron and dot | flat, drawn in code |
| 03 | One continuous glass band folded into a tab strip | premium |
| 04 | Azure disc, white browser window and cursor | flat, drawn in code |
| 05 | Glass globe with a satellite sphere | premium |
| 06 | Three stacked azure/light/ink panels | flat, drawn in code |
| 07 | Brilliant-cut azure diamond | premium |
| 08 | Blue glass trefoil cradling a sphere — **shipped** | premium |
| 09 | Two thick glass angle brackets | premium |
| 10 | Glass torus with an orbiting sphere | premium |

## Regenerating

```
node scripts/gen-icons.mjs                 # all ten, three at a time
node scripts/gen-icons.mjs 08              # just the shipped one
node scripts/gen-icons.mjs --concurrency 1 # serial

node scripts/draw-flat-icons.mjs           # re-render 02 and 04
node scripts/draw-06-stack-pages.mjs       # re-render 06
node scripts/icon-contact-sheet.mjs        # rebuild the overview sheet
```

Generated candidates land in `image/`, which is gitignored: they are exploration
output, not repo content. `build/icon.png` is the one that ships, and
`scripts/make-icon.mjs` will not overwrite it (only `--force` does).
