"""Fennel RF v0: assemble weak-labelled dataset from all belts, train, cross-validate by belt, export.
usage: assemble_and_train.py [belt ...]   (default: every belt that has series_<belt>_all_2526.json)"""
import sys, os, json, math, random, pickle, collections, datetime as dt
import numpy as np
from datetime import date
from shapely.geometry import shape
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score
from fennel_features import window_vector, FEATURE_ORDER, despike
from fennel_rules import rajasthan_pass, gujarat_pass, mp_pass, GRID, _win
from analyze_series import interp

BELTS = {'nagaur': 'raj', 'sirohi': 'raj', 'bilara': 'raj', 'mehsana': 'guj', 'banaskantha': 'guj', 'sabarkantha': 'guj', 'morbi': 'guj', 'dhar': 'mp'}
CONFUSION = {'MUSTARD', 'WHEAT', 'GRAM', 'CORN', 'MAIZE'}
RS = 42
NEG_RATIO = int(os.environ.get('NEG_RATIO', 6)); CLASS_WEIGHT = os.environ.get('CLASS_WEIGHT', 'balanced_subsample'); CLASS_WEIGHT = None if CLASS_WEIGHT == 'none' else CLASS_WEIGHT
RAJ_WEIGHT = float(os.environ.get('RAJ_WEIGHT', 1)); MIN_LEAF = int(os.environ.get('MIN_LEAF', 3)); QUIET = os.environ.get('QUIET') == '1'

def amed_top(seasons):
    best = None
    for s in seasons:
        st = dt.datetime.utcfromtimestamp(s['start']).date(); en = dt.datetime.utcfromtimestamp(s['end']).date()
        if date(2025, 10, 1) <= st <= date(2026, 1, 31) and en >= date(2026, 1, 15) and s['crop']:
            if best is None or (s['conf'] or 0) > best[1]: best = (s['crop'], s['conf'] or 0)
    return best or (None, 0.0)

def ambiguous(series, region):
    """relaxed rule: a field that is fennel-LIKE but misses the strict rule -- excluded from the negatives so the boundary is not contaminated"""
    g = GRID(2025); nd = interp(despike(series), 'ndvi', g)
    if nd is None: return False
    if region == 'raj':
        n = int((nd >= 0.74).sum()); return n >= 4 and nd.max() >= 0.8
    if region == 'mp':
        run = best = 0
        for x in nd:
            run = run + 1 if x >= 0.55 else 0; best = max(best, run)
        return best >= 8 and nd.max() >= 0.68
    jf = _win(nd, g, date(2026, 1, 15), date(2026, 2, 15)); lm = _win(nd, g, date(2026, 3, 20), date(2026, 4, 10)); oc = _win(nd, g, date(2025, 10, 20), date(2025, 11, 10))
    return oc <= 0.42 and jf >= 0.45 and lm >= 0.38

rows = []
belts = sys.argv[1:] or [b for b in BELTS if os.path.exists(f'series_{b}_all_2526.json')]
for belt in belts:
    d = json.load(open(f'series_{belt}_all_2526.json')); region = BELTS[belt]; rule = {'raj': rajasthan_pass, 'guj': gujarat_pass, 'mp': mp_pass}[region]
    n = 0
    for fid, v in d.items():
        if len(v['series']) < 10: continue
        vec = window_vector(v['series'], 2025)
        if vec is None: continue
        crop, conf = amed_top(v['seasons']); c = shape(v['geometry']).centroid
        strict = bool(rule(v['series'])); amb = (not strict) and ambiguous(v['series'], region)
        rows.append(dict(id=fid, belt=belt, region=region, vec=vec, strict=strict, ambiguous=amb, amed=crop, conf=conf, area=v['area'], lat=round(c.y, 5), lon=round(c.x, 5))); n += 1
    print(f'{belt}: {n} scoreable fields', flush=True)

def label(r):
    inelig = (r['amed'] in CONFUSION) or (r['conf'] >= 0.8)   # at inference these fields are never scored
    if r['strict'] and not inelig: return 1
    if r['strict']: return None          # strict-rule pass but AMED is confident of another crop -> unusable
    if r['ambiguous']: return None
    return 0
for r in rows: r['y'] = label(r)
pos = [r for r in rows if r['y'] == 1]; neg_all = [r for r in rows if r['y'] == 0]
hard = [r for r in neg_all if r['amed'] and r['conf'] >= 0.8]                 # AMED-confident other crops (mustard/wheat/gram/cotton/...)
rest = [r for r in neg_all if not (r['amed'] and r['conf'] >= 0.8)]
random.Random(RS).shuffle(rest)
neg = hard + rest[:max(0, NEG_RATIO * len(pos) - len(hard))]
print(f'positives {len(pos)} ({dict(collections.Counter(r["belt"] for r in pos))}); negatives {len(neg)} (AMED-confident hard {len(hard)}, random ordinary {min(len(rest), max(0, NEG_RATIO*len(pos)-len(hard)))}); ambiguous excluded {sum(r["ambiguous"] for r in rows)}')
train = pos + neg
X = np.array([r['vec'] for r in train]); y = np.array([r['y'] for r in train]); grp = np.array([r['belt'] for r in train])
mk = lambda: RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=MIN_LEAF, class_weight=CLASS_WEIGHT, random_state=RS, n_jobs=-1)
SW = np.array([RAJ_WEIGHT if (r['y'] == 1 and r['region'] == 'raj') else 1.0 for r in train])

# leave-belt-out CV (train on other belts, test on the held-out belt); flag rate measured on ALL scoreable eligible fields of that belt
print('\nLeave-one-belt-out CV (labels = weak rules, so this measures consistency, NOT accuracy against real fennel):')
cv = []
for belt in sorted(set(grp)):
    tr, te = grp != belt, grp == belt
    if y[tr].sum() < 10 or y[te].sum() < 3: print(f'  {belt}: skipped (too few positives)'); continue
    m = mk().fit(X[tr], y[tr], sample_weight=SW[tr]); p = m.predict_proba(X[te])[:, 1]
    auc = roc_auc_score(y[te], p); pred = p > 0.5; tp = int((pred & (y[te] == 1)).sum()); prec = tp / max(1, pred.sum()); rec = tp / y[te].sum()
    allb = [r for r in rows if r['belt'] == belt and not ((r['amed'] in CONFUSION) or r['conf'] >= 0.8)]
    pa = m.predict_proba(np.array([r['vec'] for r in allb]))[:, 1]
    cv.append((belt, auc, prec, rec)); print(f'  {belt:12s} AUC {auc:.2f} | @0.5 precision {prec:.2f} recall {rec:.2f} | flags {100*np.mean(pa>0.5):.1f}% of {len(allb)} eligible fields in belt')
if cv: print(f'  mean AUC {np.mean([c[1] for c in cv]):.2f}, precision {np.mean([c[2] for c in cv]):.2f}, recall {np.mean([c[3] for c in cv]):.2f}')

model = mk().fit(X, y, sample_weight=SW)
imp = sorted(zip(FEATURE_ORDER, model.feature_importances_), key=lambda t: -t[1])[:8]; print('\ntop features:', [(k, round(float(v), 3)) for k, v in imp])
ref = json.load(open('ref_commons_fennel_2020.json'))['series']; rv = window_vector(ref, 2019)
print(f'CONFIRMED reference field (Kotra, 2019-20; windows mapped by month/day) -> model probability {model.predict_proba(np.array([rv]))[0,1]:.2f}')
pickle.dump({'model': model, 'features': FEATURE_ORDER}, open('fennel_rf_v0_model.pkl', 'wb'))
json.dump({'rows': [dict(id=r['id'], belt=r['belt'], y=r['y'], amed=r['amed'], conf=r['conf'], **{f: v for f, v in zip(FEATURE_ORDER, r['vec'])}) for r in train]}, open('fennel_training_table.json', 'w'))
print('saved fennel_rf_v0_model.pkl, fennel_training_table.json')
