# Scratchpad tool

## Purpose

The scratchpad is a floating free-form notes panel in `index.html` for temporary analyst notes while inspecting a loaded track.

## Behavior

- Toggled by the `scratchpad` tool button.
- Draggable via header.
- Click header to collapse/expand body.
- Automatically brought to foreground on interaction (shared floating-tool z-index counter).
- Repositioned with viewport clamping to avoid off-screen drag.
- Content is session-local and intentionally ephemeral ("clears on refresh").

## Scope boundary

- Scratchpad state is not persisted to files, audit JSON, or backend systems.
- It is a UX utility for local analysis only, not part of pipeline computation.
