"""Weak-label rules used to pick fennel-LIKE fields in the popular belts (unvalidated hypotheses -- see ref_commons_fennel_2020.json and notes).
Rajasthan rule v1b: derived from the one confirmed fennel field (Kotra, Udaipur, 2019-20) + ICAR calendar (early-Oct sowing, Dec-Feb plateau, harvested by mid/late March).
Gujarat rule v0: Nov sowing / Mar-Apr harvest calendar: bare around sowing, green Jan-Feb, still green 20 Mar-10 Apr, and NOT re-greening after a March dip (2nd crop)."""
import numpy as np
from datetime import date, timedelta
from fennel_features import despike
from analyze_series import interp
GRID = lambda y0: [date(y0, 10, 1) + timedelta(days=7 * i) for i in range(31)]
def _win(nd, g, a, b): return float(np.mean(nd[[i for i, d in enumerate(g) if a <= d <= b]]))

def rajasthan_pass(series, y0=2025):
    g = GRID(y0); nd = interp(despike(series), 'ndvi', g)
    if nd is None: return False
    best = cur = 0; st = bs = 0
    for i, x in enumerate(nd):
        if x >= 0.78:
            if cur == 0: st = i
            cur += 1
            if cur > best: best, bs = cur, st
        else: cur = 0
    if best < 6 or nd.max() < 0.85: return False
    first, last = g[bs], g[bs + best - 1]
    apr = float(np.mean([nd[i] for i, d in enumerate(g) if d >= date(y0 + 1, 4, 1)]))
    return date(y0, 12, 10) <= first <= date(y0 + 1, 1, 25) and date(y0 + 1, 2, 10) <= last <= date(y0 + 1, 3, 20) and apr <= 0.38

def gujarat_pass(series, y0=2025):
    g = GRID(y0); nd = interp(despike(series), 'ndvi', g)
    if nd is None: return False
    oc = _win(nd, g, date(y0, 10, 20), date(y0, 11, 10)); jf = _win(nd, g, date(y0 + 1, 1, 15), date(y0 + 1, 2, 15))
    lm = _win(nd, g, date(y0 + 1, 3, 20), date(y0 + 1, 4, 10)); a2 = _win(nd, g, date(y0 + 1, 4, 20), date(y0 + 1, 4, 29)); mar = _win(nd, g, date(y0 + 1, 3, 1), date(y0 + 1, 3, 10))
    if not (oc <= 0.35 and jf >= 0.5 and lm >= 0.45): return False
    return not (mar < lm - 0.05 or a2 >= 0.45)
