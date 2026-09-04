"""
Exports the round-4 expanded RandomForestClassifier (experiment_a_v3_rf_model.pkl) to the same
plain JSON tree format as export_rf_to_json.py (verbatim export logic, not reimplemented) --
verifies the exported JSON reproduces sklearn's predict_proba exactly before being considered
trustworthy. Writes to sunflower_rf_v1_candidate.json -- an experimental artifact, NOT the
production model path. Promotion (copying into
server/src/services/agricultural/sunflowerRf/model/) is a separate, explicit step taken only
after the model comparison in the round-4 report supports it.

Run: ../.venv/bin/python3 export_rf_v3_to_json.py
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


def main():
    with open("experiment_a_v3_rf_model.pkl", "rb") as f:
        d = pickle.load(f)
    model = d["model"]
    features = d["features"]

    trees = [export_tree(est.tree_) for est in model.estimators_]
    export = {"model_version": "sunflower-rf-v1", "features": features, "n_trees": len(trees), "trees": trees}

    with open("sunflower_rf_v1_candidate.json", "w") as f:
        json.dump(export, f)
    print(f"Exported {len(trees)} trees, {len(features)} features -> sunflower_rf_v1_candidate.json")

    def predict_json(trees, x):
        probs = []
        for t in trees:
            n = t
            while not n["leaf"]:
                n = n["left"] if x[n["feature"]] <= n["threshold"] else n["right"]
            probs.append(n["prob1"])
        return sum(probs) / len(probs)

    # Verify against ALL rows actually used to train v3 (positives from all rounds + negatives),
    # reconstructed the same way assemble_and_retrain_v3.py did.
    import assemble_and_retrain_v3 as v3
    r12 = v3.load_round1_2_positives()
    r3, _ = v3.load_round3_positives()
    r4, _ = v3.load_round4_positives()
    negatives = v3.load_existing_negatives()
    all_records = r12 + r3 + r4 + negatives

    X = np.array([[r[f] for f in features] for r in all_records], dtype=float)
    real_probs = model.predict_proba(X)[:, 1]

    max_diff = 0.0
    for i in range(len(X)):
        json_prob = predict_json(trees, X[i])
        diff = abs(json_prob - real_probs[i])
        max_diff = max(max_diff, diff)
    print(f"Verification over {len(X)} real training rows: max |sklearn - exported_json| = {max_diff:.2e}")
    if max_diff > 1e-9:
        print("WARNING: exported JSON does NOT exactly reproduce sklearn predict_proba -- do not promote until fixed.")
    else:
        print("VERIFIED: exported JSON reproduces sklearn predict_proba exactly (bit-for-bit within float precision).")


if __name__ == "__main__":
    main()
