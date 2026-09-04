"""
AMED conflict audit for round-4 Tier A/B candidates -- mirrors the exact methodology used for
round 3 (haryana_round3_amed_conflict_check.json): a founder-derived Tier A/B candidate is
KEPT as a positive unless AMED's own most-recent monitoring season predicts a DIFFERENT crop
at >=0.80 confidence (the same AMED_STRONG_CONFIDENCE_THRESHOLD used throughout the production
app -- server/src/services/agricultural/sunflowerRf/config.ts, client's cropDisplay.ts).

AMED data is already present in sunflower_kurukshetra_250_new_candidates.json's own
properties.monitoring (captured at discovery time) -- no new network call needed.

"Most recent monitoring season" = the season with the latest startTimestampSec, matching the
'fallback' tier of the production getActiveCropOutcome logic (client/src/features/fields/
cropDisplay.ts) for a field with no currently-ongoing season.

Excluded (conflict) fields are NEVER turned into negatives -- only removed from the positive
candidate set. Kept in this audit file for transparency.

Run: python3 amed_conflict_check_round4.py
"""
import json

AMED_STRONG_CONFIDENCE_THRESHOLD = 0.80

scored = json.load(open("haryana_round4_scored.json"))
candidates = {f["id"]: f for f in json.load(open("sunflower_kurukshetra_250_new_candidates.json"))}

tier_ab = [r for r in scored if r["candidate_tier"] in ("A", "B")]
print(f"Tier A/B candidates to check: {len(tier_ab)}")

audit = []
for r in tier_ab:
    field_id = r["field_id"]
    feature = candidates.get(field_id)
    monitoring = (feature["properties"].get("monitoring") or []) if feature else []

    amed_crop = None
    amed_confidence = None
    decision = "KEPT"

    if monitoring:
        latest = max(monitoring, key=lambda s: s["startTimestampSec"])
        top = latest["predictions"][0] if latest.get("predictions") else None
        if top:
            amed_crop = top["crop"]
            amed_confidence = top["confidence"]
            if amed_crop not in (None, "NO_PREDICTION", "UNKNOWN_CROP") and amed_confidence >= AMED_STRONG_CONFIDENCE_THRESHOLD:
                decision = "FOUNDER_SIGNAL_AMED_CONFLICT"

    audit.append({
        "field_id": field_id,
        "tier": r["candidate_tier"],
        "amed_crop": amed_crop,
        "amed_confidence": amed_confidence,
        "decision": decision,
    })

kept = sum(1 for a in audit if a["decision"] == "KEPT")
conflict = sum(1 for a in audit if a["decision"] == "FOUNDER_SIGNAL_AMED_CONFLICT")
print(f"KEPT: {kept}, FOUNDER_SIGNAL_AMED_CONFLICT (excluded): {conflict}")
for a in audit:
    if a["decision"] == "FOUNDER_SIGNAL_AMED_CONFLICT":
        print(f"  EXCLUDED {a['field_id']} (Tier {a['tier']}): AMED={a['amed_crop']}@{a['amed_confidence']}")

json.dump(audit, open("haryana_round4_amed_conflict_check.json", "w"), indent=2)
print("Saved haryana_round4_amed_conflict_check.json")
