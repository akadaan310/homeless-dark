# Pipeline review

Reviewed current source in `/home/ubuntu/Documents/Codex/2026-10-21-new-chat/homeless-dark`, focusing on art/geography Python, source/license provenance, commission projection, and Dark.Cli argument/storage/error handling. Engine and Unity adapter semantics were deliberately excluded for the other reviewer. No code or git state was changed.

## P2 — Give HD-000 its actual spending covenant

**Location:** `tools/commission.py:12` (and extraction at lines 20–28); derived `evidence/requirements.json` first/third rows.

The regex recognizes numbered headings and **suffixed** bold HD identifiers, but does not recognize the actual `**HD-000 · Zero new expenditure.**` at constitution line 19. As a result, the projected `HD-000` row contains only `## 00. Commissioner's binding requirements — release and asset covenant`, with no acceptance requirement, while the zero-spend covenant becomes part of `HD-000.EXCLUDE`'s excerpt. This is a material stable-ID/source-clause mapping defect in the traceability tool: evidence or a PASS attached to HD-000 cannot substantiate the actual HD-000 requirement, and source-exclusion evidence alone cannot cover the extra spending covenant accidentally assigned to EXCLUDE. No present acceptance inflation was found; all 124 projected rows are currently NOT_RUN and release_accepted is false.

**Reproduction:** Import `tools/commission.py`, call `extract(SOURCE.read_text())`, and inspect rows 0 and 2: `'No paid assets' in rows[0]['text']` is false, while `'No paid assets' in rows[2]['text']` is true. The latter has ID HD-000.EXCLUDE/source_line 17 rather than HD-000/source_line 19.

**Fix:** Recognize the explicit unsuffixed HD-000 marker as the authoritative HD-000 clause, and treat the ##00 heading as a container/preamble rather than a competing row. Keep HD-000.UNITY/EXCLUDE/A–D as separate clauses, and preserve every source constraint. Add a real-source regression assertion that HD-000 contains the zero-new-expenditure covenant and EXCLUDE does not. Regenerate/reconcile the ledger deliberately.

## Verification and other observations

- Ran the specific projection reproduction above against the actual constitution, confirming 124 rows and the incorrect stable-ID mapping.
- Ran `python3 tools/art/fetch_materials.py --verify`: all 14 source maps passed size/hash verification (5 Asphalt024A, 4 Concrete034, 5 Bricks059).
- Locked current art inputs use exact HTTPS publisher/CDN hosts, archived SHA-256, per-input and expansion limits, safe ZIP members, selected filename extraction, and explicit native-unrun states. License snapshots have source URLs/hashes; the original café has its own public-domain grant. Megacity remains metadata/LFS-pointer inspection, not redistributed art or claimed checkout.
- Geography keeps raw pinned sources, uses atomic staged output, checked hashes and sizes, declares ODbL attribution/public-domain airport provenance, and separates sourced geometry from fiction. Its regional/airport delivery and missing worldwide/population layers are explicit. Geography evidence was still being finalized by its owning sibling during review.
- CLI describe/demo/replay consistently identify the local-development limitation; no native/founder/global capability claim was found. No additional material CLI issue was established by source inspection. Trusted-clock integration was being updated by the owning sibling and is outside this review's engine scope.
- Did not rerun broad suites or native checks, and did not fetch new assets/data or incur spending.
