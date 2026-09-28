"""
First experimental Safflower Random Forest, trained on safflower_training_table.json
(assemble_dataset.py's output: 16 real Latur weak positives + 250 real AMED-confirmed
negatives, both measured on the same real 2025-26 rabi calendar).

SAME RandomForestClassifier configuration as Sunflower's own models (n_estimators=300,
max_depth=6, min_samples_leaf=3, class_weight="balanced", random_state=42) -- reused
deliberately for consistency across this project's crop models, not re-tuned per crop without
cause. class_weight="balanced" matters here even more than it did for Sunflower: 16 positives
vs 250 negatives is a much more skewed real class balance (Sunflower's first experiment was
26 vs 250).

Grouped, not random, train/test split: GroupShuffleSplit keyed on field_id, so no single real
field's data leaks between train and test (matters less here since every row is already one
field, but kept for consistency with Sunflower's own methodology and to make this trivially
extensible if multi-row-per-field features are added later).

HONEST LIMITS OF THIS FIRST EXPERIMENT, stated plainly per this project's own conventions:
  - 16 positives is a very small positive class -- Sunflower's own first real experiment used
    26, and that was already flagged in this project as a small starting point.
  - No positive field has independent ground truth (see score_and_tier.py's own docstring) --
    every "positive" here is a weak label, not confirmed safflower.
  - Real, human, high-resolution visual spot-checks of a subset of these same positives found
    that some genuinely look like tree/scrub cover, not cropland -- meaning some fraction of
    the 16 labeled positives may be mislabeled at the source, not just weakly labeled.
  - This model must NOT be described as validated or production-ready. It is a first experiment
    to see whether the real feature set carries ANY separable signal at all.

Run: ../.venv/bin/python3 train_rf.py
"""
import json
import pickle

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import average_precision_score, classification_report, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit

FEATURES = [
    "ndvi_establishment", "ndvi_flowering", "ndvi_harvest",
    "ndre_establishment", "ndre_flowering", "ndre_harvest",
    "ndwi_establishment", "ndwi_flowering", "ndwi_harvest",
    "ndyi_establishment", "ndyi_flowering", "ndyi_harvest",
]


def main():
    data = json.load(open("safflower_training_table.json"))["rows"]
    print(f"Total real rows: {len(data)} ({sum(r['label'] for r in data)} positive, {sum(1 - r['label'] for r in data)} negative)\n")

    X = np.array([[r[f] for f in FEATURES] for r in data])
    y = np.array([r["label"] for r in data])
    groups = np.array([r["field_id"] for r in data])

    splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42)
    train_idx, test_idx = next(splitter.split(X, y, groups))
    print(f"Train: {len(train_idx)} rows ({y[train_idx].sum()} positive) | Test: {len(test_idx)} rows ({y[test_idx].sum()} positive)\n")

    if y[test_idx].sum() == 0:
        print("WARNING: zero positives landed in the held-out test split (real risk with only 16 positives total) -- test metrics below are not meaningful. Reporting anyway, honestly, rather than re-rolling the split until it looks better.")

    model = RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=3, class_weight="balanced", random_state=42, n_jobs=-1)
    model.fit(X[train_idx], y[train_idx])

    if y[test_idx].sum() > 0:
        proba = model.predict_proba(X[test_idx])[:, 1]
        pred = model.predict(X[test_idx])
        print("Held-out test performance (REAL data, but n=16 positives total -- wide uncertainty):")
        print(classification_report(y[test_idx], pred, target_names=["not_safflower", "safflower"]))
        print(f"ROC-AUC: {roc_auc_score(y[test_idx], proba):.3f}")
        print(f"PR-AUC:  {average_precision_score(y[test_idx], proba):.3f}")

    importances = sorted(zip(FEATURES, model.feature_importances_), key=lambda x: -x[1])
    print("\nFeature importances (real, from the fitted model, not asserted in advance):")
    for name, imp in importances:
        print(f"  {name}: {imp:.3f}")

    # The held-out split above is for honest evaluation only. The artifact actually exported for
    # serving is refit on ALL real rows (same convention as Sunflower's own promoted models) --
    # evaluation and the deployed model are never the same fit.
    final_model = RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=3, class_weight="balanced", random_state=42, n_jobs=-1)
    final_model.fit(X, y)
    pickle.dump({"model": final_model, "features": FEATURES}, open("safflower_rf_v0_model.pkl", "wb"))
    print(f"\nWrote safflower_rf_v0_model.pkl (refit on all {len(y)} real rows -- this is the artifact export_rf_to_json.py converts, NOT the held-out-evaluated model above).")


if __name__ == "__main__":
    main()
