"""
Applies the frozen score_and_tier.py logic (unchanged since round 1) to the round-3 extraction
results. Zero new satellite calls -- pure scoring of already-extracted features.

Run: python3 score_round3.py
"""
import json
from score_and_tier import score_and_tier_all
from collections import Counter

d = json.load(open("haryana_round3_results.json"))
results = d["results"]
ok = [r for r in results if r.get("status") == "ok"]
err = [r for r in results if r.get("status") != "ok"]
print(f"Total attempted: {len(results)}, OK: {len(ok)}, errors: {len(err)}")
for e in err:
    print("  ERROR:", e["field_id"], e.get("error"))

scored = score_and_tier_all(ok)
tier_counts = Counter(r["candidate_tier"] for r in scored)
print(f"\nTier counts: {dict(tier_counts)}")
print(f"Exact-rule passes (Tier A): {sum(1 for r in scored if r['baseline_rule_pass'])}")

json.dump(scored, open("haryana_round3_scored.json", "w"), indent=2)
print("Saved haryana_round3_scored.json")
