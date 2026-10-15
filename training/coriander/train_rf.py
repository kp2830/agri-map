"""
Coriander RF v0 -- first experimental model, same pattern as training/safflower/train_rf.py.

POSITIVES: 14 real, ground-collected AgriFieldNet coriander fields (IDinsight, rabi 2021-22; UP/Rajasthan/
Bihar/Odisha). NEGATIVES: 36 AgriFieldNet wheat/mustard/gram fields (same year/region) + 30 AMED-confirmed
wheat/mustard/gram fields from the Hadoti (Baran-Kota) belt, features re-extracted on the same calendar
months (2025-26 rabi). The Hadoti rule-passing candidates are NOT used as positives (circular: they were
chosen by the rule the features define).

FEATURES (4, fixed order; same month windows at train and predict time):
  ndvi_dec        median NDVI  Dec 1  - Dec 31
  ndyi_decfeb     median NDYI  Dec 15 - Feb 15   (white umbels: low; mustard/gram bloom yellow)
  ndvi_feb        median NDVI  Feb 1  - Mar 10
  ndvi_mar        median NDVI  Mar 1  - Mar 31
HONEST STATE: 14 positives, one real year for them, 66 negatives. Treat as an experiment to see whether the
signal is separable -- not a validated classifier.

Run: training/esa/.venv/bin/python training/coriander/train_rf.py
"""
import json, pickle
from pathlib import Path
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import RepeatedStratifiedKFold

HERE = Path(__file__).resolve().parent
FEATS = ["ndvi_dec", "ndyi_decfeb", "ndvi_feb", "ndvi_mar"]
SRC = {"ndvi_dec": "dec_ndvi", "ndyi_decfeb": "yellow_ndyi", "ndvi_feb": "feb_ndvi", "ndvi_mar": "mar_ndvi"}

def row(d): return [d[SRC[f]] for f in FEATS]
def ok(d): return all(isinstance(d.get(SRC[f]), (int, float)) for f in FEATS)

rows = []
for d in json.loads((HERE / "afn_features.json").read_text()):
    if ok(d): rows.append((row(d), 1 if d["crop"] == "coriander" else 0, "afn"))
for d in json.loads((HERE / "hadoti_amed_negatives.json").read_text()).values():
    if "error" not in d and ok(d): rows.append((row(d), 0, "hadoti"))
X = np.array([r[0] for r in rows]); y = np.array([r[1] for r in rows]); src = np.array([r[2] for r in rows])
print(f"rows {len(y)}  positives {int(y.sum())}  negatives {int((1-y).sum())} (afn {int(((y==0)&(src=='afn')).sum())}, hadoti {int(((y==0)&(src=='hadoti')).sum())})")

def mk(): return RandomForestClassifier(n_estimators=300, max_depth=4, min_samples_leaf=3, class_weight="balanced", random_state=42, n_jobs=-1)

# 1) repeated stratified CV
aucs, prec, rec = [], [], []
for tr, te in RepeatedStratifiedKFold(n_splits=4, n_repeats=10, random_state=42).split(X, y):
    m = mk().fit(X[tr], y[tr]); p = m.predict_proba(X[te])[:, 1]
    aucs.append(roc_auc_score(y[te], p)); pred = p >= 0.5
    tp = int(((pred == 1) & (y[te] == 1)).sum()); fp = int(((pred == 1) & (y[te] == 0)).sum()); fn = int(((pred == 0) & (y[te] == 1)).sum())
    prec.append(tp / (tp + fp) if tp + fp else 0.0); rec.append(tp / (tp + fn) if tp + fn else 0.0)
print(f"CV (4-fold x10): AUC {np.mean(aucs):.2f} +/- {np.std(aucs):.2f} | precision@0.5 {np.mean(prec):.2f} | recall@0.5 {np.mean(rec):.2f}")

# 2) transfer check: train only on AgriFieldNet, test on the Hadoti negatives (different state, different year)
a = src == "afn"; m = mk().fit(X[a], y[a]); ph = m.predict_proba(X[~a])[:, 1]
print(f"AFN-only model on Hadoti negatives (n={int((~a).sum())}): flagged coriander (p>=0.5): {int((ph >= 0.5).sum())}  mean p {ph.mean():.2f}")

# 3) final fit on everything, save
final = mk().fit(X, y)
print("feature importances:", dict(zip(FEATS, np.round(final.feature_importances_, 2))))
pickle.dump({"model": final, "features": FEATS}, open(HERE / "coriander_rf_v0_model.pkl", "wb"))
json.dump({"rows": [dict(zip(FEATS, map(float, x)), label=int(l), source=s) for x, l, s in zip(X, y, src)]}, open(HERE / "coriander_training_table.json", "w"))
print("saved coriander_rf_v0_model.pkl")
