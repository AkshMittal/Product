---
name: logbook-design-brief
description: Design brief for the Mountain GPX Logbook surface. Use when designing, prototyping, or reviewing any UI for the logbook entry view, stats panels, map component, data quality indicators, or settings surfaces. Enforces the product's design philosophy and prevents generic AI defaults.
---

# Logbook Surface — Design Brief

## Purpose

This skill defines the visual and interaction language for the logbook surface. It exists to prevent generic AI-generated UI and to enforce this product's identity: a serious, honest, data-first tool for mountain athletes who care about precision.

Read and follow this brief before designing any component of the logbook surface.

---

## Product Identity

This is not a fitness social app. It is closer to an expedition instrument: something a technical mountaineer would trust to be truthful about their data.

The product's core value is honesty-first computation. The UI must reflect this. Data quality, coverage, exclusion reasons, and metric confidence should all be visible and navigable — not hidden to look cleaner. Uncertainty should be expressed as information, not hidden as a flaw.

Users are serious mountain athletes: alpinists, ultra-runners, ski mountaineers, high-altitude climbers. They know their data is noisy. They respect a tool that is honest about it.

---

## Aesthetic Direction

**Primary reference**: expedition company websites like Elite Exped — muted, earthy, functional. Think field notebook meets precision instrument. Not a consumer fitness app.

**Tone**: Quiet confidence. Dense but not chaotic. Every element earns its place.

**Not**: Strava blue, Apple Watch fitness rings, gradient hero banners, glass morphism cards, cheerful progress circles, rounded pill buttons on everything.

Key qualities to pursue:
- Muted, intentional palette — nothing should shout
- Typography carries the hierarchy, not color or decoration
- Negative space is used deliberately, not generously
- The product should feel like something an engineer or mountain guide would respect

The aesthetic is still being explored. When proposing a design direction, always produce at least two visual options at different ends of the tone spectrum: one more editorial/earthy, one more instrument/technical. Never just pick one and present it as final.

---

## Color Philosophy

Preference leans toward two directions — keep both open until tested:

**Option A — Near-monochrome with a sharp accent**
- Background: very dark slate or off-black (not pure #000000)
- Surface: slightly lighter slate for cards/panels
- Text: off-white primary, muted gray secondary
- Accent: one vivid color for interactive elements and data highlights (amber, electric blue, or red — not purple, not teal)
- Use accent sparingly — only for: interactive states, critical metric values, track line color

**Option B — Earth/expedition tones**
- Background: deep stone, dark earth, or charcoal-brown
- Surface: muted sand, aged paper, or warm dark tones
- Text: warm off-white and muted cream
- Accent: burnt orange, deep ochre, or forest green
- Avoid anything that looks like a hiking brand's marketing site

**Rules for both**:
- Never use the default Tailwind blue (#3B82F6) or generic indigo
- Never use full-saturation colors for large surfaces
- Elevation profile and track line may use a gradient — but it must be intentional and tied to data (e.g., elevation-based coloring), not decorative
- Dark mode is the primary mode. Light mode is secondary

---

## Typography

- Use a characterful font stack — not Inter, Roboto, Arial, or system fonts as the main display face
- Numeric and metric data should use a monospace or tabular-figures typeface for alignment
- Headers: a distinctive serif or geometric display font for the product name/page titles
- Body and labels: a clean, legible sans-serif (not generic)
- Good candidates to explore: Instrument Serif, DM Mono, Space Mono, Epilogue, Archivo, Syne, or similar with strong personality
- Import from Google Fonts — always declare the font stack explicitly

Typography hierarchy:
- Track title / page title — large, display weight
- Metric value — large, monospace, high contrast
- Metric label — small, muted, all-caps or tracked
- Secondary data — smaller, lower contrast
- Quality/audit notices — distinct treatment, not buried

---

## Information Architecture — Logbook Entry View

The logbook entry view is the core product surface. It contains:

### Primary visible zone (above fold / no scroll required)
- Track title and date
- Key metrics: distance, duration, elevation gain, moving time
- Map view (significant but not dominating — roughly 40-55% of viewport)
- Data quality indicator (coverage ratio and quality level: high / caution / invalid)

### Secondary zone (accessible via scroll or panel expand)
- Full elevation profile (interactive, synced with map)
- Extended metrics: pace, speed, grade distributions
- Timestamp and sampling audit summary
- Exclusion breakdown (how much data was excluded and why)

### Deep dive (accessible via dedicated panel/tab)
- Full GPX audit panel: per-module results (timestamp, sampling, motion, elevation)
- Canonical geometry profile declaration
- Raw vs processed comparison
- Advanced settings for the processing profile

**Hierarchy rule**: never hide quality or coverage information in an obscure settings page. A user should see, at a glance from the main view, whether the computed metrics are trustworthy. The quality indicator must always be visible alongside metrics, not buried.

---

## Map Component

The map is a significant visual element and an interactive storytelling tool.

Rules:
- Map and stats are tightly coupled — hovering a point on the map should highlight corresponding position in the elevation profile and vice versa
- The track line should be styled to match the product aesthetic (not default blue Leaflet line)
- Track coloring can optionally encode elevation or speed gradient — but must be declared, not decorative
- The map should never be so small that the route shape is illegible
- The map should never dominate so completely that stats are pushed off-screen
- Do not use default OpenStreetMap tiles if possible — explore Stadia, Mapbox Outdoors, or a topo-style tile layer that fits the mountain context
- Satellite/topo hybrid view is appropriate and relevant for mountain routes

Starting size: map takes approximately 45-55% of the main view viewport. This is a starting point — test and adjust.

---

## Data Honesty — Visual Expression

The product's "honesty-first" principle must show up visually:

- **Quality level** (`high` / `caution` / `invalid`) must be displayed alongside every computed metric — not just in a separate panel
- **Coverage ratio** (what percentage of data was eligible for this computation) should be shown as a small indicator near each metric, e.g., `94% coverage`
- **Exclusion reasons** should be accessible — a user who clicks on a "caution" indicator should see what caused it
- **Never present processed data as if it is raw** — if the track shown is canonical geometry (processed), that should be indicated somewhere, however subtly
- Data marked as low-quality should be visually distinct but not hidden — e.g., a muted/dashed representation of excluded segments on the map

Design for the technical user who will notice if the numbers don't add up. Transparency earns trust.

---

## Anti-Patterns — Never Do These

These are hard blockers. If any of these appear in a proposed design, it must be rejected and redone:

1. **Generic fitness app aesthetic** — Strava-blue palette, orange rings, confetti on completion, "You crushed it!" copy
2. **Gradient hero banners** with centered text over a mountain photo
3. **Glass morphism cards** with blur effects used decoratively
4. **Rounded pill buttons** on every interactive element
5. **Progress/donut rings** for metric display — use numbers, not rings
6. **Generic icon libraries** used without consideration — SFSymbols or Lucide can be used but must fit the tone
7. **Hiding uncertainty** — if data quality is caution or invalid, it cannot be displayed with the same visual treatment as high-quality data
8. **Removing the map** to make the layout "cleaner"
9. **Defaulting to Inter or system fonts** without a design rationale
10. **White background with blue accents** as the default color decision

---

## Interaction Principles

- **Map ↔ stats sync**: interactions on the map (hover, scrub) should reflect in the elevation profile and metric highlights; scrubbing the elevation profile should move a cursor on the map
- **Progressive disclosure**: show key metrics by default, deeper audit data on expand — never overwhelm but never hide
- **No gratuitous animation**: transitions should be functional (state change, focus, data load) — not decorative scroll animations
- **Hover states must exist** on all interactive elements — do not leave unstyled
- **Empty states must be designed** — what does the logbook look like before any tracks are uploaded? Design it.
- **Loading states must be designed** — skeleton loaders or minimal spinners, not blank white flashes
- **Mobile-aware**: the logbook must work on mobile, though desktop is the primary experience for deep analysis

---

## Output Format for Design Proposals

When proposing a design or component, always include:

1. **Layout description** — what is visible and where, using plain language or annotated wireframe
2. **Component list** — what components are needed
3. **Color tokens used** — reference the palette (Option A or B) explicitly, not arbitrary hex values
4. **Typography decisions** — which font for which element and why
5. **Data contract** — what data does this component need to render
6. **Slop check** — explicitly confirm none of the anti-patterns above are present
7. **Open questions** — anything that requires the developer's input before implementation

Always present two design variants when the aesthetic direction is still being decided.
