# Web UI design guidelines

Layout and component conventions for the admin UI in `web/src` (Settings, Capabilities, Providers, etc.).

## Component stack (shadcn/ui)

- Primitives live in [`src/components/ui/`](src/components/ui/) and are installed/maintained with the [shadcn/ui](https://ui.shadcn.com) CLI (`web/components.json`).
- Add or update primitives: `cd web && npx shadcn@latest add <name> -y -o` (overwrite existing files intentionally). If the CLI writes under `web/@/components/ui/`, copy into `web/src/components/ui/` and remove the stray `@` folder.
- **Do not** hand-roll Radix replacements in `components/ui/`. Business-only widgets (e.g. [`infinite-table.tsx`](src/components/ui/infinite-table.tsx), [`markdown-viewer.tsx`](src/components/ui/markdown-viewer.tsx)) stay in `components/ui/` when they are not shadcn registry components.
- [`src/components/select-field.tsx`](src/components/select-field.tsx) is an app-level helper around shadcn `Select` (options array + empty-value sentinel). Prefer it over duplicating `SelectTrigger` / `SelectItem` markup; use raw shadcn `Select` when you need custom layout.

### Form controls

| Use case      | Component                                                       |
| ------------- | --------------------------------------------------------------- |
| Single choice | shadcn `Select` or `SelectField`                                |
| Text / number | `Input` + `Label`                                               |
| Boolean       | `Checkbox` + `Label`                                            |
| Multi-line    | native `textarea` with the same border/radius tokens as `Input` |
| File picker   | native `<input type="file">` (hidden) is OK                     |

**Anti-patterns:** native `<select>`; unstyled `<input type="checkbox">` for UI toggles.

Theme: semantic tokens in [`src/styles/globals.css`](src/styles/globals.css) use **HSL components** (e.g. `--background: 0 0% 12%`) so they work with `hsl(var(--token))` in [`tailwind.config.js`](tailwind.config.js). `html` may use `class="dark"` for shadcn `dark:` variants; `:root` and `.dark` share the same palette.

### Typography (compact admin UI)

- Main content uses `text-xs` on `<main>`; feature code often sets `text-xs` on fields and `text-sm` on section titles.
- shadcn primitives under `components/ui/` are tuned for this density (no root `text-sm` on `Card`, `Label`/`Select`/`Input` defaults match the pre-shadcn scale). After `shadcn add`, re-check font sizes if Nova defaults creep back in.
- Form fields: `Input` / `Select` use `border-border` + `bg-background` so they read clearly on `bg-card` sections; native `textarea` should use the same pair.

## Right-aligned action rows

These are **layout rules**, not shared components—copy the markup structure in each feature; do not extract a cross-feature Save/ActionBar component unless a separate design-system effort explicitly adds one.

## Right-aligned action rows

Use this pattern when a section ends with a right-aligned Save or primary action plus short status text.

| Rule                                   | Detail                                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anchor the primary button on the right | Main `Button` uses `shrink-0` so its right edge stays fixed when hints appear or disappear.                                                              |
| Short hints go left of the button      | Success, unsaved, or sync status text lives in a `flex-1 min-w-0 text-right` area **before** the button, never after it in the same row.                 |
| Long copy on its own row               | Errors, restart-required notices, and other multi-line messages use a full-width `<p>` below the action row (`space-y-2`), not inline beside the button. |
| Stabilize toggling button labels       | When the label switches (e.g. Save vs Up to date), set `min-w-[7rem]` (or similar) on the button so width changes do not shift the row.                  |
| Optional right slot                    | Extra controls (e.g. Routing actions) sit **to the right of** the primary button with `shrink-0`. Hints still stay **left of** the button.               |

### Reference markup (structure only)

```tsx
<div className="space-y-2 pt-2">
  <div className="flex items-center justify-end gap-2">
    <div className="flex-1 min-w-0 min-h-[1.25rem] flex items-center justify-end text-right text-[10px]">
      {/* Short status: Saved / Unsaved changes / Matches saved config */}
    </div>
    <Button size="sm" className="h-7 shrink-0 text-xs">
      ...
    </Button>
    {/* Optional: rightSlot with shrink-0 */}
  </div>
  {/* Full-width error or restart notice */}
</div>
```

`min-h-[1.25rem]` on the hint area avoids vertical jump when the hint is empty.

### Anti-patterns

- **Do not** place hints after the button: `Button` then `{condition && <span>hint</span>}` inside `justify-end`—the hint widens the row and pushes the button right.
- **Do not** treat variable-width status text as a sibling to the right of the button in LTR flex rows.
- **Do not** fold long error or restart copy into the same flex row as the button.

## Status colors

| Meaning                 | Classes                              |
| ----------------------- | ------------------------------------ |
| Success                 | `text-green-600 dark:text-green-500` |
| Warning / unsaved       | `text-amber-600 dark:text-amber-500` |
| Neutral                 | `text-muted-foreground`              |
| Error (block below row) | `text-destructive`                   |

Use i18n keys for user-visible strings; avoid hardcoded English in feature code.
