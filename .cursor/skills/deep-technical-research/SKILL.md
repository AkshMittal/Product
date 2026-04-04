---
name: deep-technical-research
description: >-
  Evidence-backed technical research for algorithms, GNSS/GPS, trajectory smoothing,
  signal processing, and geospatial pipelines. Tool-agnostic workflow (no required
  Firecrawl/Exa): uses whatever search, fetch, or browser MCPs are available, plus
  user-supplied sources. Use for deep dives, literature-style surveys, and
  “what methods exist / when are they valid” questions before implementation.
inspired_by: ECC deep-research (adapted)
---

# Deep Technical Research

Produce **thorough, cited** research on technical topics—especially **noisy GPS/GPX**, **trajectory estimation**, **smoothing and filtering**, **map matching**, and **audit/correction pipelines**—without assuming any single vendor MCP. Borrow the rigor of multi-step deep research; add **constraints** so work stays honest in **niche** domains where sources are sparse.

## When to Activate

- User asks for a **deep dive**, **literature-style survey**, or **state of the art** on a technical method
- Comparing approaches (e.g. Kalman vs robust estimators vs splines vs particle filters) **with assumptions and failure modes**
- “What do people use in production / papers / open source for X?”
- Before building a **correction** or **kinematic** layer: map options, prerequisites, and risks
- User says **research**, **survey**, **evidence**, **citations**, or **what’s known about**

**Do not use for:** pure market sizing, investor dossiers, or competitor positioning—use **`market-research`** instead.

## Tools (No Fixed Vendor)

Use **whatever is actually available** in the session:

| Capability | Examples (use if present) |
|------------|---------------------------|
| Web search | Product web search, search MCP, etc. |
| Fetch / read URL | Web fetch tools, HTTP MCP, Firecrawl/Exa **if** configured |
| Browser | Browser MCP: open URL, snapshot, extract visible content |
| User | Pasted links, PDFs, repo paths, “read this paper” |

**There is no requirement** to install Firecrawl or Exa. If those tools exist, treat them as **optional accelerators**, not prerequisites.

### Credit and volume constraints

- Prefer **depth on fewer sources** over scraping dozens of thin pages.
- Default target: **8–20 distinct sources** for a medium topic; **3–8** for a very narrow sub-question. Adjust if the user asks for lighter or heavier scope.
- If using a **metered** API (e.g. crawl/scrape credits): **batch** queries, **avoid** sitewide crawls unless the user explicitly wants that; fetch **full text** only for sources that pass a quick relevance check.
- For **paywalled** content: use abstracts, open-access versions, preprints, or ask the user for a PDF—do not assume full-text access.

## Workflow

### 1. Clarify the goal (lightweight)

Unless the user says to skip:

- **Outcome**: learning only vs decision for implementation vs doc to keep in repo?
- **Scope**: one subsystem (e.g. “post-process horizontal path only”) vs end-to-end?

If they say **“just research it”**, proceed with sensible defaults and state them in the report **Methodology** section.

### 2. Plan sub-questions

Break the topic into **3–5** concrete sub-questions. Examples for trajectory smoothing:

- What problem class is each method designed for (real-time fusion vs offline smoothing)?
- What statistical / dynamical **assumptions** are explicit?
- Where do methods **fail** (multipath, gaps, wrong dynamics, non-Gaussian noise)?
- What does **open literature or OSS** use for consumer-grade tracks?

### 3. Retrieve with variety

For **each** sub-question:

- Run **2–3 query variants** (synonyms, “survey”, “review”, “GNSS”, “robust”, “map matching”).
- Prioritize: **peer-reviewed / textbooks / official standards / reputable labs** over random blogs.
- Prefer **recency** when the field moves fast; for fundamentals, older canonical sources are fine—**say which** and why.

### 4. Deep-read a short shortlist

Pick **3–5** highest-value sources and read **substantively** (full article, key sections, or methods section)—not only snippets.

### 5. Synthesize

Follow the **Report structure** below. **Mandatory** sections: **Executive summary**, **Key takeaways**, **Sources**, **Gaps and uncertainty**, **Methodology**.

### 6. Deliver

- **Short** brief: full report in chat.
- **Long** survey: executive summary + takeaways in chat; offer to save the full report under `docs/research/` (or user-specified path) if they want it versioned.

### Optional: parallel tracks

For **broad** topics, split sub-questions across parallel agent tasks **only if** the harness supports it; merge into one report with a single **Sources** list and no duplicate numbering.

## Quality Rules

1. **Important claims need a citable source** (link, DOI, or bibliographic detail). If uncited, label as **hypothesis** or **engineer judgment**.
2. **Single-source claims**: flag as **weakly supported**.
3. **Separate** **fact** (from sources), **inference** (your synthesis), and **recommendation** (what to build or try).
4. **Contradictions**: note disagreements between sources; do not flatten them silently.
5. **Niche honesty**: if little exists, say **“insufficient public material found”** and list what was tried (queries, venues).
6. **No fabrication**: if not found, do not invent paper titles or URLs.

## Relationship to This Product

When research touches **GPX audit / correction / canonical track**:

- Align suggestions with **observation-only audit** vs **explicit correction profiles** (see project ADRs and `docs/project/`).
- Call out methods that **smuggle assumptions** into “cleanup” vs methods suitable as **named, versioned** processing steps.

## Report structure (template)

Deliver the final write-up with these sections, in order:

1. **Title** — `[Topic]: Technical research brief`
2. **Metadata line** — Date, number of sources consulted, **Confidence: High / Medium / Low**
3. **Executive summary** — 3–6 sentences focused on decisions
4. **Sub-questions investigated** — numbered list
5. **Thematic sections** (1–3+) — findings with **inline citations** (link or DOI) per important claim
6. **Comparison table** (optional) — columns: Method/family | Assumptions | Typical use | Main failure modes | Notes
7. **Key takeaways** — bullets, decision-relevant
8. **Gaps and uncertainty** — what could not be verified; what needs experiments or proprietary data
9. **Sources** — numbered list: title, author/venue/year, URL or DOI, one-line relevance
10. **Methodology** — queries tried, tools used (search / fetch / browser / user files), reading depth, date cutoff if any

## Examples

- “Survey **robust smoothing** options for **offline** consumer GPS tracks.”
- “When is **Kalman** vs **RTS smoother** vs **splines** appropriate for **post-processed** geometry?”
- “**Map-matching** basics and what breaks in **mountain** / sparse road contexts.”
- “**Elevation fusion**: DEM vs baro vs recorded—assumptions and literature pointers.”
