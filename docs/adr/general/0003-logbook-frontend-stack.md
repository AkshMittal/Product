# ADR-0003: Logbook frontend stack: Next.js, Mapbox GL, Tailwind, Recharts, Radix

**Date**: 2026-04-02
**Status**: accepted
**Deciders**: Product / engineering (documented in `.cursor/rules/frontend-stack.mdc`)

## Context

The MVP centers on a **personal mountain log**: track library, per-track audit inspection, map-forward UX, and charts that show metrics **with** quality and exclusion context. The stack must support App Router–style routing, type-safe UI code, map rendering suited to terrain, and components that avoid generic “SaaS template” aesthetics—which would undermine a deliberate outdoor product identity.

Constraints: mountain/topographic map affordances; need for accessible primitives without adopting heavy pre-styled kits that dictate look-and-feel; alignment with project design skills (`design-system`, `logbook-design-brief`).

## Decision

The logbook web app uses **Next.js** with the **App Router** and **TypeScript**, **Tailwind CSS** for styling, **Mapbox GL JS** for maps (preferring styles appropriate for mountain/topographic contexts), **Recharts** as the default charting layer (upgrading only when a chart needs custom rendering), and **Radix UI** (or similar primitives-first unstyled building blocks) for interaction primitives—avoiding default shadcn-style shipped aesthetics as the product default.

Design guardrails (fonts, accent colors, data-quality visibility) are treated as product requirements, not optional polish.

## Alternatives Considered

### Alternative 1: Leaflet (or other 2D leaflet-style stack) instead of Mapbox GL

- **Pros**: Open ecosystem; lighter licensing conversation for some teams; familiar plugin model.
- **Cons**: Less alignment with the chosen standard for vector terrain styling and the team’s locked frontend stack defaults.
- **Why not**: Mapbox GL JS is the project standard for logbook map work unless explicitly revisited.

### Alternative 2: Charting library with heavier bundle or bespoke D3-first approach for all charts

- **Pros**: Maximum flexibility; potentially richer custom geo-linked visuals later.
- **Cons**: Higher implementation cost for MVP charts; slower iteration for standard time-series and profile views.
- **Why not**: Recharts is the default until a specific visualization outgrows it.

### Alternative 3: Pre-styled component library (e.g., default shadcn/marketing patterns) as the primary UI kit

- **Pros**: Fast early screens; familiar patterns for developers.
- **Cons**: Collides with explicit anti-defaults in the design brief; risks generic SaaS look and hiding data-quality context behind “clean” dashboards.
- **Why not**: Rejected—primitives-first styling with intentional typography and color discipline.

### Alternative 4: Pages Router or non-React stack

- **Pros**: Simpler mental model for tiny apps; possible performance perks in niche cases.
- **Cons**: Diverges from established direction for this codebase; App Router matches current rule set.
- **Why not**: Locked to App Router + TS unless the user explicitly changes course.

## Consequences

### Positive

- Coherent defaults for agents and contributors implementing the logbook surface.
- Map and chart choices match mountain use cases and iteration speed goals.
- UI can stay distinctive while remaining accessible via Radix-style primitives.

### Negative

- Mapbox licensing and token handling become part of operational baseline.
- Teams must resist importing pre-styled kits that break design constraints.

### Risks

- **Risk**: Creeping adoption of generic UI kits or default Tailwind blue accents. **Mitigation**: Enforce `frontend-stack` + design skills in review; spot-check key screens against logbook brief.
