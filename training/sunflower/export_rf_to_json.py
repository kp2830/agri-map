"""
Exports the real trained Experiment A RandomForestClassifier (experiment_a_rf_model.pkl) to a
plain JSON tree structure that can be walked by a small, dependency-free TypeScript inference
engine in production -- avoids needing Python/scikit-learn in the Node/Express Render deployment
(which has none today; see server/package.json's dependency list). max_depth=6, 300 trees is
small enough that this is a completely faithful, exact re-implementation, not an approximation.

Verifies the exported JSON reproduces the REAL sklearn model's predict_proba exactly (to floating
point precision) on the actual training data before considering the export trustworthy.

Run: ../.venv/bin/python3 export_rf_to_json.py
"""
import json
import pickle
import numpy as np


def export_tree(tree):
    """One sklearn tree -> nested JSON. Leaf nodes carry the real class-1 probability computed
    from that leaf's real training-sample class counts (tree_.value), exactly what sklearn uses
    internally for predict_proba on an unweighted single tree."""
    def node(i):
        if tree.children_left[i] == tree.children_right[i] == -1:
            counts = tree.value[i][0]
            total = counts.sum()
            return {"leaf": True, "prob1": float(counts[1] / total) if total > 0 else 0.0}
        return {
            "leaf": False,
            "feature": int(tree.feature[i]),
            "threshold": float(tree.threshold[i]),
            "left": node(tree.children_left[i]),
            "right": node(tree.children_right[i]),
        }
    return node(0)


def main():
    with open("experiment_a_rf_model.pkl", "rb") as f:
        d = pickle.load(f)
    model = d["model"]
    features = d["features"]

    trees = [export_tree(est.tree_) for est in model.estimators_]
    export = {"model_version": "sunflower-rf-v0", "features": features, "n_trees": len(trees), "trees": trees}

    with open("sunflower_rf_v0.json", "w") as f:
        json.dump(export, f)
    print(f"Exported {len(trees)} trees, {len(features)} features -> sunflower_rf_v0.json")

    # ---- verification: exported JSON must reproduce sklearn's predict_proba EXACTLY ----
    def predict_json(trees, x):
        probs = []
        for t in trees:
            n = t
            while not n["leaf"]:
                n = n["left"] if x[n["feature"]] <= n["threshold"] else n["right"]
            probs.append(n["prob1"])
        return sum(probs) / len(probs)

    exp_a = json.load(open("experiment_a_dataset.json"))
    X = np.array([[r[f] for f in features] for r in exp_a["records"]], dtype=float)
    real_probs = model.predict_proba(X)[:, 1]

    max_diff = 0.0
    for i in range(len(X)):
        json_prob = predict_json(trees, X[i])
        diff = abs(json_prob - real_probs[i])
        max_diff = max(max_diff, diff)
    print(f"Verification over {len(X)} real training rows: max |sklearn - exported_json| = {max_diff:.2e}")
    if max_diff > 1e-9:
        print("WARNING: exported JSON does NOT exactly reproduce sklearn predict_proba -- do not use in production until fixed.")
    else:
        print("VERIFIED: exported JSON reproduces sklearn predict_proba exactly (bit-for-bit within float precision).")


if __name__ == "__main__":
    main()
