"""Exports fennel_rf_v0_model.pkl to the same plain-JSON tree format as Sunflower/Safflower/Coriander and verifies the JSON
reproduces sklearn's predict_proba exactly on every training row. Writes fennel_rf_v0_candidate.json (promotion = copy to
server/src/services/agricultural/fennelRf/model/fennel_rf_v0.json).
Run: ../.venv/bin/python export_rf_to_json.py"""
import json, pickle
import numpy as np

def export_tree(tree):
    def node(i):
        if tree.children_left[i] == tree.children_right[i] == -1:
            counts = tree.value[i][0]; total = counts.sum()
            return {"leaf": True, "prob1": float(counts[1] / total) if total > 0 else 0.0}
        return {"leaf": False, "feature": int(tree.feature[i]), "threshold": float(tree.threshold[i]),
                "left": node(tree.children_left[i]), "right": node(tree.children_right[i])}
    return node(0)

def predict_json(trees, x):
    probs = []
    for t in trees:
        n = t
        while not n["leaf"]: n = n["left"] if float(np.float32(x[n["feature"]])) <= n["threshold"] else n["right"]  # sklearn compares float32 features against float64 thresholds
        probs.append(n["prob1"])
    return sum(probs) / len(probs)

d = pickle.load(open("fennel_rf_v0_model.pkl", "rb")); model, features = d["model"], d["features"]
trees = [export_tree(est.tree_) for est in model.estimators_]
json.dump({"model_version": "fennel-rf-v2", "features": features, "n_trees": len(trees), "trees": trees}, open("fennel_rf_v0_candidate.json", "w"))
rows = json.load(open("fennel_training_table.json"))["rows"]
X = np.array([[r[f] for f in features] for r in rows])
sk = model.predict_proba(X)[:, 1]; js = np.array([predict_json(trees, x) for x in X])
md = float(np.max(np.abs(sk - js)))
print(f"Exported {len(trees)} trees, {len(features)} features; verified on {len(rows)} rows, max diff vs sklearn {md:.2e}", "-> OK" if md < 1e-9 else "-> DO NOT PROMOTE")
json.dump([{"x": X[i].tolist(), "p": float(sk[i])} for i in range(0, len(rows), max(1, len(rows)//40))], open("/tmp/fennel_infer_cases.json", "w"))
