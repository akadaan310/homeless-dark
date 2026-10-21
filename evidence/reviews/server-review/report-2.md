# Second scoped server review

Read-only review of World, mechanics, entities and streaming, after initial namespace/refusal fixes. Four entity World and three streaming World tests passed independently. Current integration work continues in parallel, so findings refer to probe time.

## P2: oversized integer bypasses typed refusal

`World.execute` with a valid action envelope and `manual_move` input `east=10**1000,north=0` raises `OverflowError` from `world.finite` (`math.isfinite` converts the integer to float). The request is below8192bytes and the protocol exception handler does not include OverflowError. The transaction remains unchanged, but an authenticated malformed request loses its structured HTTP response. Compare range before float conversion or catch conversion overflow centrally; add direct and HTTP regressions.

## P2: distant cancellation/retirement is gated by preparation proximity

`streaming.act` checks distance<=2km before dispatching every operation, including cleanup. Prepare cafe-cell, walk to harbor and advance2000ticks. `cancel_cell` then refuses PREPARATION_RANGE; the cell remains RESERVE after expiry120 and continues accounting its reserved bytes. Apply proximity to preparation/activation, while permitting owner cleanup at distance; provide admitted expiry cleanup without requiring a return journey.

`probes-2.py` reproduces both cases without editing repository content or live World files. `probes-2.log` records exact outputs. Root was already fixing the independently known broad manual walk-region bypass of removed topology edges, so this pass does not duplicate that finding. Native collision, full-world integration and adversarial operator replacement are outside this review.

## Continuity fix evidence

Root assigned the Outbox cancellation race fix separately. Ten tests now pass: durable attempted marker before invoke; cancel only never-dispatched requests; unknown outcome survives restart/deadline; v1 ambiguous prepared rows migrate conservatively to unknown; exact same-actor own-event receipt reconciliation never redispatches; delayed concurrent403 cannot overwrite a confirmed commit. Real-thread cancellation regression uses an actual World commit. Receipt helper requires caller authentication of actor and receipt source; JSON cannot grant authority. Local deadline blocks new sends; already dispatched requests may commit after it. Independent review of this fix is pending.
