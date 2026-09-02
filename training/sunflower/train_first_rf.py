"""
First experimental Random Forest for the Kurukshetra-Karnal weakly-supervised sunflower dataset.

26 positives / 205 negatives, 231 total real fields -- explicitly a small, weakly-labeled,
imbalanced first experiment. Every metric below describes agreement with the co-founder's
temporal weak-label hypothesis, applied to a dataset containing a real region+year confound
(see assemble_rf_dataset.py's docstring) -- NOT a production accuracy claim, NOT independently
validated against ground truth.

Field-level split: each row already IS exactly one field (no repeated observations per field in
this schema), so a plain stratified split cannot leak the same field across train/test -- but
with only 26 positives, a single held-out split would be unstable, so this uses stratified 5-fold
cross-validation (grouped trivially since group=row here) and reports the spread across folds,
not a single number pretending to be precise.

Run: ../.venv/bin/python3 train_first_rf.py
"""
import json
import statistics
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import (
    precision_score, recall_score, f1_score, roc_auc_score, average_precision_score,
    confusion_matrix, classification_report,
)

FEATURES = [
    "ndvi_apr", "ndvi_may", "ndvi_june", "ndvi_apr_june_change",
    "ndre_apr", "ndre_may", "ndre_june",
    "ndwi_apr", "ndwi_may", "ndwi_june",
    "ndyi_apr", "ndyi_may", "ndyi_june",
]
# valid_pixel_fraction excluded: found to be a real, caught data-leakage source. The positives'
# raw daily series explicitly records a null for a cloud-masked day; the negatives' stored raw
# series (from an earlier extraction run/client version) only ever contains entries for days
# that already had a valid mean -- invalid days are omitted upstream, not null-marked. That
# structural difference means ANY coverage fraction computed from "nulls vs total entries" is
# systematically different between the two classes regardless of the real underlying cloud
# conditions -- not a real vegetation signal, a pipeline-provenance signal. Excluded rather than
# patched further for this first experiment; a real fix would require re-extracting the 205
# negatives with the current client so both classes share one real extraction method.


def main():
    d = json.load(open("kurukshetra_rf_training_dataset.json"))
    records = d["records"]

    X = np.array([[r[f] for f in FEATURES] for r in records], dtype=float)
    y = np.array([r["label"] for r in records])
    field_ids = [r["field_id"] for r in records]

    print(f"Dataset: {len(records)} rows, {y.sum()} positive, {(y==0).sum()} negative")
    print(f"Features ({len(FEATURES)}): {FEATURES}")

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

    rf = RandomForestClassifier(
        n_estimators=300, max_depth=6, min_samples_leaf=3,
        class_weight="balanced", random_state=42, n_jobs=-1,
    )

    probs = cross_val_predict(rf, X, y, cv=skf, method="predict_proba")[:, 1]
    preds = (probs >= 0.5).astype(int)

    fold_metrics = []
    for fold_i, (train_idx, test_idx) in enumerate(skf.split(X, y)):
        rf_fold = RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=3, class_weight="balanced", random_state=42, n_jobs=-1)
        rf_fold.fit(X[train_idx], y[train_idx])
        fold_probs = rf_fold.predict_proba(X[test_idx])[:, 1]
        fold_preds = (fold_probs >= 0.5).astype(int)
        n_pos_test = y[test_idx].sum()
        fold_metrics.append({
            "fold": fold_i + 1, "n_test": len(test_idx), "n_pos_test": int(n_pos_test),
            "precision": precision_score(y[test_idx], fold_preds, zero_division=0),
            "recall": recall_score(y[test_idx], fold_preds, zero_division=0),
            "f1": f1_score(y[test_idx], fold_preds, zero_division=0),
            "roc_auc": roc_auc_score(y[test_idx], fold_probs) if len(set(y[test_idx])) > 1 else None,
        })
        print(f"Fold {fold_i+1}: n_test={len(test_idx)} (pos={n_pos_test}) precision={fold_metrics[-1]['precision']:.3f} recall={fold_metrics[-1]['recall']:.3f} f1={fold_metrics[-1]['f1']:.3f} roc_auc={fold_metrics[-1]['roc_auc']}")

    print("\n=== Cross-validated (5-fold) aggregate, out-of-fold predictions ===")
    print(f"Precision: {precision_score(y, preds, zero_division=0):.3f}")
    print(f"Recall:    {recall_score(y, preds, zero_division=0):.3f}")
    print(f"F1:        {f1_score(y, preds, zero_division=0):.3f}")
    print(f"ROC-AUC:   {roc_auc_score(y, probs):.3f}")
    print(f"Average Precision (PR-AUC): {average_precision_score(y, probs):.3f}")
    cm = confusion_matrix(y, preds)
    print(f"Confusion matrix [[TN,FP],[FN,TP]]:\n{cm}")
    print(classification_report(y, preds, target_names=["negative", "weak_positive"], zero_division=0))

    roc_aucs = [m["roc_auc"] for m in fold_metrics if m["roc_auc"] is not None]
    print(f"\nROC-AUC across folds: mean={statistics.mean(roc_aucs):.3f} min={min(roc_aucs):.3f} max={max(roc_aucs):.3f} (spread reflects the small positive count per fold, ~5 positives/fold)")

    # Final model on ALL data, for feature importance reporting (not for held-out evaluation)
    rf_final = RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=3, class_weight="balanced", random_state=42, n_jobs=-1)
    rf_final.fit(X, y)
    importances = sorted(zip(FEATURES, rf_final.feature_importances_), key=lambda x: -x[1])
    print("\n=== Feature importances (Random Forest, trained on all 231 rows) ===")
    for feat, imp in importances:
        print(f"{feat:24s} {imp:.4f}")

    # Misclassified positives (false negatives) and highest-confidence false positives -- for
    # honest error inspection, not to cherry-pick a nicer story.
    false_negatives = [(field_ids[i], probs[i]) for i in range(len(y)) if y[i] == 1 and preds[i] == 0]
    false_positives = sorted([(field_ids[i], probs[i]) for i in range(len(y)) if y[i] == 0 and preds[i] == 1], key=lambda x: -x[1])

    out = {
        "dataset": {"n_total": len(records), "n_positive": int(y.sum()), "n_negative": int((y == 0).sum())},
        "features": FEATURES,
        "fold_metrics": fold_metrics,
        "cv_aggregate": {
            "precision": precision_score(y, preds, zero_division=0), "recall": recall_score(y, preds, zero_division=0),
            "f1": f1_score(y, preds, zero_division=0), "roc_auc": roc_auc_score(y, probs),
            "average_precision": average_precision_score(y, probs),
            "confusion_matrix": cm.tolist(),
        },
        "roc_auc_fold_spread": {"mean": statistics.mean(roc_aucs), "min": min(roc_aucs), "max": max(roc_aucs)},
        "feature_importances": [{"feature": f, "importance": float(i)} for f, i in importances],
        "false_negatives": false_negatives,
        "false_positives_top10": false_positives[:10],
    }
    json.dump(out, open("kurukshetra_rf_first_experiment_results.json", "w"), indent=2)
    print("\nSaved kurukshetra_rf_first_experiment_results.json")


if __name__ == "__main__":
    main()
