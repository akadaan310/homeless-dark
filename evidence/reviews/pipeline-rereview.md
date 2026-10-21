# Scoped pipeline re-review

**Prior P2 HD-000 miskey: ADDRESSED.**

Reviewed only `tools/commission.py`, `tests/test_commission.py`, and the regenerated `evidence/requirements.json`. The extractor now recognizes the explicit unsuffixed HD-000 clause, suppresses its organizational heading as a separate requirement, and assigns the actual zero-new-expenditure covenant to HD-000 at constitution source line 19. HD-000.EXCLUDE at line 17 no longer contains that covenant. The other explicit HD-000 subclauses remain separate; there are still 124 unique rows.

Executed `python3 -m unittest discover -s tests -p 'test_commission.py' -v`: all five tests passed, including the actual-constitution regression. Independently called projection `verify` against the regenerated ledger; it passed. Confirmed all ledger rows remain NOT_RUN and release_accepted remains false. No remaining finding in the scoped fix.

No source or git edits performed.
