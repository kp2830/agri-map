"""
Exports safflower_rf_v0_model.pkl (train_rf.py's full-data refit) to the same plain-JSON tree
format as Sunflower's export_rf_to_json.py / export_rf_v3_to_json.py -- verbatim export logic,
not reimplemented -- and verifies the exported JSON reproduces sklearn's real predict_proba
exactly on every real training row before being considered trustworthy.

Writes to safflower_rf_v0_candidate.json -- an experimental artifact, NOT the production model
path. Promotion (copying into server/src/services/agricultural/safflowerRf/model/) is a
separate, explicit step.

Run: ../.venv/bin/python3 export_rf_to_json.py
"""
import json
import pickle

import numpy as np


def export_tree(tree):
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


def predict_json(trees, x):
    probs = []
    for t in trees:
        n = t
        while not n["leaf"]:
            n = n["left"] if x[n["feature"]] <= n["threshold"] else n["right"]
        probs.append(n["prob1"])
    return sum(probs) / len(probs)


def main():
    with open("safflower_rf_v0_model.pkl", "rb") as f:
        d = pickle.load(f)
    model = d["model"]
    features = d["features"]

    trees = [export_tree(est.tree_) for est in model.estimators_]
    export = {"model_version": "safflower-rf-v0", "features": features, "n_trees": len(trees), "trees": trees}

    with open("safflower_rf_v0_candidate.json", "w") as f:
        json.dump(export, f)
    print(f"Exported {len(trees)} trees, {len(features)} features -> safflower_rf_v0_candidate.json")

    # Verify against every real row the model was actually trained on.
    rows = json.load(open("safflower_training_table.json"))["rows"]
    X = np.array([[r[f] for f in features] for r in rows])

    sklearn_probs = model.predict_proba(X)[:, 1]
    json_probs = np.array([predict_json(trees, x) for x in X])
    max_diff = float(np.max(np.abs(sklearn_probs - json_probs)))
    print(f"Verified against {len(rows)} real rows -- max diff vs sklearn predict_proba: {max_diff:.2e}")
    if max_diff > 1e-9:
        print("WARNING: exported JSON does not exactly reproduce sklearn's predictions -- do NOT promote this artifact.")
    else:
        print("Exact match (floating-point epsilon). Safe to promote once reviewed.")


if __name__ == "__main__":
    main()
