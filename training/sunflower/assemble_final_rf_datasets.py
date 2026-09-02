"""
Assembles the two datasets for this round's experiments:

Experiment A: 25 AMED-filtered founder positives vs 205 existing Indian AMED negatives
              (training/data/pilot/amed_negative_manifest.jsonl + amed_sentinel2_features.jsonl)
Experiment B: the SAME 25 positives vs 211 same-region/same-season Kurukshetra-Karnal Tier D
              fields, used as a BACKGROUND/domain-robustness check -- NOT confirmed negatives.

Positives: the 26 Tier A/B weak candidates minus the 1 field excluded for a high-confidence (80.6%)
competing AMED CORN prediction (8J2R3W22+GJG3, preserved separately as FOUNDER_SIGNAL_AMED_CONFLICT
metadata, never used in training). label_source=cofounder_temporal_heuristic on every positive row;
rule_type = EXACT_RULE (Tier A, passed the co-founder's literal NDVI>0.5/NDVI<0.25 rule) or
MARGINAL_TIER_B (Tier B, real decline but didn't clear both hard thresholds) preserved per row.

Run: ../.venv/bin/python3 assemble_final_rf_datasets.py
"""
import json
import statistics

WINDOWS = {"apr": ("04-15", "04-30"), "may": ("05-01", "05-20"), "june": ("06-01", "06-15")}


def in_window(date_str, window):
    return window[0] <= date_str[5:10] <= window[1]


def window_mean(daily_obs, window):
    vals = [o["mean"] for o in daily_obs if o["mean"] is not None and isinstance(o["mean"], (int, float)) and in_window(o["date"], window)]
    return statistics.mean(vals) if vals else None


FEATURES = ["ndvi_apr", "ndvi_may", "ndvi_june", "ndvi_apr_june_change",
            "ndre_apr", "ndre_may", "ndre_june", "ndwi_apr", "ndwi_may", "ndwi_june",
            "ndyi_apr", "ndyi_may", "ndyi_june"]


def load_positives():
    d = json.load(open("kurukshetra_karnal_sunflower_weak_labels.json"))
    conflict_map = {r["field_id"]: r for r in json.load(open("kurukshetra_karnal_amed_conflict_check.json"))}

    positives = []
    excluded = []
    for r in d["records"]:
        if r["candidate_tier"] not in ("A", "B"):
            continue
        conf = conflict_map.get(r["field_id"])
        if conf and conf["decision"] == "FOUNDER_SIGNAL_AMED_CONFLICT":
            excluded.append({"field_id": r["field_id"], "tier": r["candidate_tier"], "amed_crop": conf["amed_crop"], "amed_confidence": conf["amed_confidence"], "status": "FOUNDER_SIGNAL_AMED_CONFLICT"})
            continue
        row = {f: r[f] for f in FEATURES}
        row.update({
            "field_id": r["field_id"], "label": 1,
            "rule_type": "EXACT_RULE" if r["candidate_tier"] == "A" else "MARGINAL_TIER_B",
            "label_source": "cofounder_temporal_heuristic",
            "amed_crop": conf["amed_crop"] if conf else None, "amed_confidence": conf["amed_confidence"] if conf else None,
        })
        positives.append(row)
    return positives, excluded


def load_existing_negatives():
    manifest = {}
    with open("../data/pilot/amed_negative_manifest.jsonl") as f:
        for line in f:
            d = json.loads(line)
            manifest[d["field_id"]] = d
    out = []
    with open("../data/pilot/amed_sentinel2_features.jsonl") as f:
        for line in f:
            feat = json.loads(line)
            fid = feat["field_id"]
            if fid not in manifest:
                continue
            idx = feat["indices"]
            row = {"field_id": fid, "label": 0, "label_source": "amed_negative_pilot_2021_deccan"}
            missing = False
            for band in ["ndvi", "ndre", "ndwi", "ndyi"]:
                for wname, window in WINDOWS.items():
                    v = window_mean(idx.get(band, []), window)
                    row[f"{band}_{wname}"] = v
                    if v is None:
                        missing = True
            row["ndvi_apr_june_change"] = (row["ndvi_apr"] - row["ndvi_june"]) if (row["ndvi_apr"] is not None and row["ndvi_june"] is not None) else None
            if not missing:
                out.append(row)
    return out


def load_tier_d_background():
    d = json.load(open("kurukshetra_karnal_sunflower_weak_labels.json"))
    out = []
    for r in d["records"]:
        if r["candidate_tier"] != "D":
            continue
        row = {f: r[f] for f in FEATURES}
        row.update({"field_id": r["field_id"], "label": 0, "label_source": "kurukshetra_tier_d_background_NOT_confirmed_negative"})
        out.append(row)
    return out


def main():
    positives, excluded = load_positives()
    existing_negatives = load_existing_negatives()
    tier_d_background = load_tier_d_background()

    print(f"Positives (AMED-filtered): {len(positives)}")
    print(f"  EXACT_RULE (Tier A): {sum(1 for p in positives if p['rule_type']=='EXACT_RULE')}")
    print(f"  MARGINAL_TIER_B: {sum(1 for p in positives if p['rule_type']=='MARGINAL_TIER_B')}")
    print(f"Excluded (FOUNDER_SIGNAL_AMED_CONFLICT, not used): {len(excluded)} -> {excluded}")
    print(f"Existing Indian negatives (usable): {len(existing_negatives)}")
    print(f"Tier D background fields: {len(tier_d_background)}")

    # ---- feature schema compatibility check ----
    print("\n=== Feature schema compatibility check ===")
    for f in FEATURES:
        pos_vals = [p[f] for p in positives if p[f] is not None]
        neg_vals = [n[f] for n in existing_negatives if n[f] is not None]
        print(f"  {f:24s} positives: n={len(pos_vals)} range=[{min(pos_vals):.3f},{max(pos_vals):.3f}]  negatives: n={len(neg_vals)} range=[{min(neg_vals):.3f},{max(neg_vals):.3f}]")

    exp_a = positives + existing_negatives
    exp_b = positives + tier_d_background

    json.dump({"features": FEATURES, "positives": positives, "excluded": excluded, "records": exp_a}, open("experiment_a_dataset.json", "w"), indent=2)
    json.dump({"features": FEATURES, "positives": positives, "records": exp_b}, open("experiment_b_dataset.json", "w"), indent=2)
    print(f"\nExperiment A: {len(exp_a)} rows ({len(positives)} pos / {len(existing_negatives)} neg)")
    print(f"Experiment B: {len(exp_b)} rows ({len(positives)} pos / {len(tier_d_background)} background)")
    print("Saved experiment_a_dataset.json, experiment_b_dataset.json")


if __name__ == "__main__":
    main()
