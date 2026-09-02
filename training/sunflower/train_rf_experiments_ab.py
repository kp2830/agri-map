"""
Experiment A: 25 AMED-filtered founder positives vs 205 existing Indian negatives (2021 Deccan).
Experiment B: the SAME 25 positives vs 211 same-region/same-season Kurukshetra-Karnal Tier D
              fields, used as a background/domain-robustness check -- NOT confirmed negatives.

Both use 5-fold stratified CV (out-of-fold predictions) with the same 13-feature set (no
valid_pixel_fraction -- see the prior run's leakage note). Positives are weak labels
(cofounder_temporal_heuristic), never described as ground truth.

Run: ../.venv/bin/python3 train_rf_experiments_ab.py
"""
import json
import pickle
import statistics
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import (
    precision_score, recall_score, f1_score, roc_auc_score, average_precision_score, confusion_matrix,
)

FEATURES = ["ndvi_apr", "ndvi_may", "ndvi_june", "ndvi_apr_june_change",
            "ndre_apr", "ndre_may", "ndre_june", "ndwi_apr", "ndwi_may", "ndwi_june",
            "ndyi_apr", "ndyi_may", "ndyi_june"]


def run_experiment(name, dataset_path, model_out_path):
    d = json.load(open(dataset_path))
    records = d["records"]
    X = np.array([[r[f] for f in FEATURES] for r in records], dtype=float)
    y = np.array([r["label"] for r in records])

    print(f"\n{'='*60}\n{name}\n{'='*60}")
    print(f"Rows: {len(records)} ({y.sum()} positive, {(y==0).sum()} class-0)")

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    probs = cross_val_predict(
        RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=3, class_weight="balanced", random_state=42, n_jobs=-1),
        X, y, cv=skf, method="predict_proba",
    )[:, 1]
    preds = (probs >= 0.5).astype(int)

    fold_aucs = []
    for fold_i, (tr, te) in enumerate(skf.split(X, y)):
        m = RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=3, class_weight="balanced", random_state=42, n_jobs=-1)
        m.fit(X[tr], y[tr])
        fp = m.predict_proba(X[te])[:, 1]
        auc = roc_auc_score(y[te], fp) if len(set(y[te])) > 1 else None
        fold_aucs.append(auc)
        print(f"  fold {fold_i+1}: n_test={len(te)} pos_test={y[te].sum()} roc_auc={auc}")

    precision = precision_score(y, preds, zero_division=0)
    recall = recall_score(y, preds, zero_division=0)
    f1 = f1_score(y, preds, zero_division=0)
    roc_auc = roc_auc_score(y, probs)
    pr_auc = average_precision_score(y, probs)
    cm = confusion_matrix(y, preds)

    print(f"\nPrecision: {precision:.3f}  Recall: {recall:.3f}  F1: {f1:.3f}  ROC-AUC: {roc_auc:.3f}  PR-AUC: {pr_auc:.3f}")
    print(f"Confusion matrix [[TN,FP],[FN,TP]]:\n{cm}")

    pos_probs = probs[y == 1]
    neg_probs = probs[y == 0]
    print(f"Predicted-probability distribution (positives): min={pos_probs.min():.3f} max={pos_probs.max():.3f} mean={pos_probs.mean():.3f} median={statistics.median(pos_probs):.3f}")
    print(f"Predicted-probability distribution (class 0):   min={neg_probs.min():.3f} max={neg_probs.max():.3f} mean={neg_probs.mean():.3f} median={statistics.median(neg_probs):.3f}")

    # Final model on all data for feature importances + saving
    final_model = RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=3, class_weight="balanced", random_state=42, n_jobs=-1)
    final_model.fit(X, y)
    importances = sorted(zip(FEATURES, final_model.feature_importances_), key=lambda x: -x[1])
    print("\nFeature importances:")
    for feat, imp in importances:
        print(f"  {feat:24s} {imp:.4f}")

    with open(model_out_path, "wb") as f:
        pickle.dump({"model": final_model, "features": FEATURES}, f)
    print(f"Saved model to {model_out_path}")

    valid_aucs = [a for a in fold_aucs if a is not None]
    return {
        "name": name, "n_rows": len(records), "n_positive": int(y.sum()), "n_class0": int((y == 0).sum()),
        "precision": precision, "recall": recall, "f1": f1, "roc_auc": roc_auc, "pr_auc": pr_auc,
        "confusion_matrix": cm.tolist(),
        "fold_roc_aucs": fold_aucs, "fold_roc_auc_mean": statistics.mean(valid_aucs) if valid_aucs else None,
        "probability_distribution": {
            "positive": {"min": float(pos_probs.min()), "max": float(pos_probs.max()), "mean": float(pos_probs.mean()), "median": float(statistics.median(pos_probs))},
            "class0": {"min": float(neg_probs.min()), "max": float(neg_probs.max()), "mean": float(neg_probs.mean()), "median": float(statistics.median(neg_probs))},
        },
        "feature_importances": [{"feature": f, "importance": float(i)} for f, i in importances],
    }


def main():
    result_a = run_experiment("EXPERIMENT A: 25 founder positives vs 205 existing Indian negatives (2021 Deccan)",
                               "experiment_a_dataset.json", "experiment_a_rf_model.pkl")
    result_b = run_experiment("EXPERIMENT B: 25 founder positives vs 211 same-region/same-season Tier D background (NOT confirmed negatives)",
                               "experiment_b_dataset.json", "experiment_b_rf_model.pkl")

    json.dump({"experiment_a": result_a, "experiment_b": result_b}, open("rf_experiments_ab_results.json", "w"), indent=2)
    print("\nSaved rf_experiments_ab_results.json")


if __name__ == "__main__":
    main()
