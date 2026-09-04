"""
Combines the existing 43 round-1/2/3 positives (already the experiment_a_v2 candidate) with the
new round-4 AMED-filtered positives, against the SAME 205 existing Indian negatives used for the
deployed sunflower-rf-v0 model. SAME 13-feature schema, SAME RandomForestClassifier
hyperparameters as assemble_and_retrain_v2.py / train_rf_experiments_ab.py (Experiment A) -- no
methodology changes.

This is an OFFLINE experimental retrain -- it does NOT overwrite the deployed
server/src/services/agricultural/sunflowerRf/model/sunflower_rf_v0.json artifact. That requires
an explicit, separate promotion step (see MODEL COMPARISON in the round-4 report).

Run: ../.venv/bin/python3 assemble_and_retrain_v3.py
"""
import json
import pickle
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, StratifiedShuffleSplit, cross_val_predict
from sklearn.metrics import precision_score, recall_score, f1_score, roc_auc_score, average_precision_score, confusion_matrix

FEATURES = ["ndvi_apr", "ndvi_may", "ndvi_june", "ndvi_apr_june_change",
            "ndre_apr", "ndre_may", "ndre_june", "ndwi_apr", "ndwi_may", "ndwi_june",
            "ndyi_apr", "ndyi_may", "ndyi_june"]


def load_round1_2_positives():
    """The 25 round-1/2 positives already used for the deployed sunflower-rf-v0 model."""
    d = json.load(open("experiment_a_dataset.json"))
    return [r for r in d["records"] if r["label"] == 1]


def load_round3_positives():
    conflict_map = {r["field_id"]: r for r in json.load(open("haryana_round3_amed_conflict_check.json"))}
    scored = json.load(open("haryana_round3_scored.json"))

    positives, excluded = [], []
    for r in scored:
        if r["candidate_tier"] not in ("A", "B"):
            continue
        conf = conflict_map.get(r["field_id"])
        if conf and conf["decision"] == "FOUNDER_SIGNAL_AMED_CONFLICT":
            excluded.append({"field_id": r["field_id"], "tier": r["candidate_tier"], "amed_crop": conf["amed_crop"], "amed_confidence": conf["amed_confidence"]})
            continue
        row = {f: r[f] for f in FEATURES if f != "ndvi_apr_june_change"}
        row["ndvi_apr_june_change"] = r["ndvi_apr_minus_june"]
        row.update({
            "field_id": r["field_id"], "label": 1,
            "rule_type": "EXACT_RULE" if r["candidate_tier"] == "A" else "MARGINAL_TIER_B",
            "label_source": "cofounder_temporal_heuristic_round3",
            "amed_crop": conf["amed_crop"] if conf else None, "amed_confidence": conf["amed_confidence"] if conf else None,
        })
        positives.append(row)
    return positives, excluded


def load_round4_positives():
    conflict_map = {r["field_id"]: r for r in json.load(open("haryana_round4_amed_conflict_check.json"))}
    scored = json.load(open("haryana_round4_scored.json"))

    positives, excluded = [], []
    for r in scored:
        if r["candidate_tier"] not in ("A", "B"):
            continue
        conf = conflict_map.get(r["field_id"])
        if conf and conf["decision"] == "FOUNDER_SIGNAL_AMED_CONFLICT":
            excluded.append({"field_id": r["field_id"], "tier": r["candidate_tier"], "amed_crop": conf["amed_crop"], "amed_confidence": conf["amed_confidence"]})
            continue
        row = {f: r[f] for f in FEATURES if f != "ndvi_apr_june_change"}
        row["ndvi_apr_june_change"] = r["ndvi_apr_minus_june"]
        row.update({
            "field_id": r["field_id"], "label": 1,
            "rule_type": "EXACT_RULE" if r["candidate_tier"] == "A" else "MARGINAL_TIER_B",
            "label_source": "cofounder_temporal_heuristic_round4",
            "amed_crop": conf["amed_crop"] if conf else None, "amed_confidence": conf["amed_confidence"] if conf else None,
        })
        positives.append(row)
    return positives, excluded


WINDOWS = {"apr": ("04-15", "04-30"), "may": ("05-01", "05-20"), "june": ("06-01", "06-15")}


def in_window(date_str, window):
    return window[0] <= date_str[5:10] <= window[1]


def window_mean(daily_obs, window):
    import statistics
    vals = [o["mean"] for o in daily_obs if o["mean"] is not None and isinstance(o["mean"], (int, float)) and in_window(o["date"], window)]
    return statistics.mean(vals) if vals else None


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


def main():
    r12_positives = load_round1_2_positives()
    r3_positives, r3_excluded = load_round3_positives()
    r4_positives, r4_excluded = load_round4_positives()
    negatives = load_existing_negatives()

    print(f"Round 1+2 positives (existing, already in production model): {len(r12_positives)}")
    print(f"Round-3 positives (AMED-filtered): {len(r3_positives)} (excluded {len(r3_excluded)})")
    print(f"Round-4 NEW positives (AMED-filtered): {len(r4_positives)}")
    print(f"  EXACT_RULE (Tier A): {sum(1 for p in r4_positives if p['rule_type'] == 'EXACT_RULE')}")
    print(f"  MARGINAL_TIER_B: {sum(1 for p in r4_positives if p['rule_type'] == 'MARGINAL_TIER_B')}")
    print(f"Round-4 excluded (FOUNDER_SIGNAL_AMED_CONFLICT, not used): {len(r4_excluded)}")
    for e in r4_excluded:
        print(f"  {e['field_id']} (Tier {e['tier']}): AMED={e['amed_crop']}@{e['amed_confidence']}")

    all_positives = r12_positives + r3_positives + r4_positives
    print(f"\nTotal positives (all rounds): {len(all_positives)}")
    print(f"Negatives (unchanged, same 205 as production model): {len(negatives)}")

    all_records = all_positives + negatives
    X = np.array([[r[f] for f in FEATURES] for r in all_records], dtype=float)
    y = np.array([r["label"] for r in all_records])

    splitter = StratifiedShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_idx, test_idx = next(splitter.split(X, y))
    print(f"\nTrain: {len(train_idx)} rows ({y[train_idx].sum()} positive). Held-out test: {len(test_idx)} rows ({y[test_idx].sum()} positive).")

    X_train, y_train = X[train_idx], y[train_idx]
    X_test, y_test = X[test_idx], y[test_idx]

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_probs = cross_val_predict(
        RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=3, class_weight="balanced", random_state=42, n_jobs=-1),
        X_train, y_train, cv=skf, method="predict_proba",
    )[:, 1]
    cv_preds = (cv_probs >= 0.5).astype(int)
    print(f"\n=== 5-fold CV on TRAIN split only ({len(X_train)} rows) ===")
    print(f"Precision: {precision_score(y_train, cv_preds, zero_division=0):.3f}  Recall: {recall_score(y_train, cv_preds, zero_division=0):.3f}  F1: {f1_score(y_train, cv_preds, zero_division=0):.3f}  ROC-AUC: {roc_auc_score(y_train, cv_probs):.3f}  PR-AUC: {average_precision_score(y_train, cv_probs):.3f}")

    model = RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=3, class_weight="balanced", random_state=42, n_jobs=-1)
    model.fit(X_train, y_train)
    test_probs = model.predict_proba(X_test)[:, 1]
    test_preds = (test_probs >= 0.5).astype(int)
    cm = confusion_matrix(y_test, test_preds)
    print(f"\n=== HELD-OUT TEST evaluation ({len(X_test)} rows NEVER seen during training) ===")
    print(f"Precision: {precision_score(y_test, test_preds, zero_division=0):.3f}")
    print(f"Recall: {recall_score(y_test, test_preds, zero_division=0):.3f}")
    print(f"F1: {f1_score(y_test, test_preds, zero_division=0):.3f}")
    print(f"ROC-AUC: {roc_auc_score(y_test, test_probs):.3f}")
    print(f"PR-AUC: {average_precision_score(y_test, test_probs):.3f}")
    print(f"Confusion matrix [[TN,FP],[FN,TP]]:\n{cm}")

    importances = sorted(zip(FEATURES, model.feature_importances_), key=lambda x: -x[1])
    print("\nFeature importances:")
    for feat, imp in importances:
        print(f"  {feat:24s} {imp:.4f}")

    with open("experiment_a_v3_rf_model.pkl", "wb") as f:
        pickle.dump({"model": model, "features": FEATURES, "trained_on": "train_split_only"}, f)
    print("\nSaved experiment_a_v3_rf_model.pkl (OFFLINE candidate -- NOT deployed until explicitly promoted)")

    results = {
        "n_round1_2_positives": len(r12_positives),
        "n_round3_positives": len(r3_positives),
        "n_round3_excluded_amed_conflict": len(r3_excluded),
        "n_round4_new_positives": len(r4_positives),
        "n_round4_excluded_amed_conflict": len(r4_excluded),
        "round4_excluded_detail": r4_excluded,
        "n_total_positives": len(all_positives),
        "n_negatives": len(negatives),
        "n_total_rows": len(all_records),
        "features": FEATURES,
        "rf_config": {"n_estimators": 300, "max_depth": 6, "min_samples_leaf": 3, "class_weight": "balanced", "random_state": 42},
        "train_split": {"n_rows": int(len(X_train)), "n_positive": int(y_train.sum())},
        "test_split": {"n_rows": int(len(X_test)), "n_positive": int(y_test.sum())},
        "cv_on_train": {
            "precision": precision_score(y_train, cv_preds, zero_division=0), "recall": recall_score(y_train, cv_preds, zero_division=0),
            "f1": f1_score(y_train, cv_preds, zero_division=0), "roc_auc": roc_auc_score(y_train, cv_probs), "pr_auc": average_precision_score(y_train, cv_probs),
        },
        "held_out_test": {
            "precision": precision_score(y_test, test_preds, zero_division=0), "recall": recall_score(y_test, test_preds, zero_division=0),
            "f1": f1_score(y_test, test_preds, zero_division=0), "roc_auc": roc_auc_score(y_test, test_probs), "pr_auc": average_precision_score(y_test, test_probs),
            "confusion_matrix": cm.tolist(),
        },
        "feature_importances": [{"feature": f, "importance": float(i)} for f, i in importances],
    }
    json.dump(results, open("experiment_a_v3_results.json", "w"), indent=2)
    print("Saved experiment_a_v3_results.json")


if __name__ == "__main__":
    main()
