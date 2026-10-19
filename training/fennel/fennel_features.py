"""Feature vector for Fennel RF v0 -- the SINGLE definition shared by training and (ported 1:1 to) server/src/services/agricultural/fennelRf/featureExtraction.ts.

Input: per-scene field means {d: 'YYYY-MM-DD', ndvi, ndre, ndyi} for ONE rabi season (Oct 1 .. Apr 30).
0) drop scenes where NDVI/NDRE/NDYI is not finite.
1) scene QC (despike): drop a scene whose NDVI differs from the median of its up-to-4 neighbouring scenes (2 before, 2 after, needs >=3) by >0.15,
   or whose NDYI differs by >0.20, or NDYI > 0.80 (haze/shadow/bad cloud-mask scenes seen in real data).
2) 13 calendar windows (oct, nov1, nov2, dec1, dec2, jan1, jan2, feb1, feb2, mar1, mar2, apr1, apr2); feature = MEDIAN of the scene means inside the window.
3) windows with no scene are filled by linear interpolation between the nearest filled windows (edges copy the nearest); if more than 3 of 13 windows are empty the field is unscoreable (None).
Vector order: ndvi_<13 windows> then ndre_<13 windows> (26 features)."""
import numpy as np
from datetime import date

WINDOWS = [('oct', (10, 1), (10, 31)), ('nov1', (11, 1), (11, 15)), ('nov2', (11, 16), (11, 30)), ('dec1', (12, 1), (12, 15)), ('dec2', (12, 16), (12, 31)),
           ('jan1', (1, 1), (1, 15)), ('jan2', (1, 16), (1, 31)), ('feb1', (2, 1), (2, 14)), ('feb2', (2, 15), (2, 28)), ('mar1', (3, 1), (3, 15)),
           ('mar2', (3, 16), (3, 31)), ('apr1', (4, 1), (4, 15)), ('apr2', (4, 16), (4, 30))]
FEATURE_ORDER = [f'ndvi_{w[0]}' for w in WINDOWS] + [f'ndre_{w[0]}' for w in WINDOWS]
MAX_EMPTY_WINDOWS = 3

def despike(series):
    s = sorted(series, key=lambda x: x['d']); out = []
    for i, x in enumerate(s):
        nb = [s[j] for j in range(max(0, i - 2), min(len(s), i + 3)) if j != i]
        if len(nb) >= 3:
            mn = float(np.median([y['ndvi'] for y in nb])); my = float(np.median([y['ndyi'] for y in nb]))
            if abs(x['ndvi'] - mn) > 0.15 or abs(x['ndyi'] - my) > 0.20: continue
        if x['ndyi'] > 0.80: continue
        out.append(x)
    return out

def _fill(vals):
    idx = [i for i, v in enumerate(vals) if v is not None]
    if not idx: return None
    out = list(vals)
    for i, v in enumerate(vals):
        if v is not None: continue
        left = [j for j in idx if j < i]; right = [j for j in idx if j > i]
        if left and right:
            a, b = left[-1], right[0]; out[i] = vals[a] + (vals[b] - vals[a]) * (i - a) / (b - a)
        elif left: out[i] = vals[left[-1]]
        else: out[i] = vals[right[0]]
    return out

def window_vector(series, season_start_year):
    series = [x for x in series if all(np.isfinite([x['ndvi'], x['ndre'], x['ndyi']]))]  # drop scenes with any non-finite index
    s = despike(series); y0 = season_start_year
    cols = {'ndvi': [], 'ndre': []}
    empty = 0
    for name, a, b in WINDOWS:
        ya = y0 if a[0] >= 10 else y0 + 1
        lo, hi = date(ya, *a).isoformat(), date(ya, *b).isoformat()
        sc = [x for x in s if lo <= x['d'] <= hi]
        if not sc: empty += 1
        for k in cols: cols[k].append(float(np.median([x[k] for x in sc])) if sc else None)
    if empty > MAX_EMPTY_WINDOWS: return None
    a, b = _fill(cols['ndvi']), _fill(cols['ndre'])
    if a is None or b is None: return None
    return a + b
