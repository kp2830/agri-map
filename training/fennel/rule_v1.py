"""Fennel phenology rule v1, derived from ONE confirmed fennel field (ref_commons_fennel_2020.json) + ICAR calendar.
Shape-based and season-shift tolerant. usage: rule_v1.py <series_all.json> <out.json> [season_start_year=2025]"""
import sys, json, collections, numpy as np, datetime as dt
from datetime import date, timedelta
from analyze_series import interp
from candidates import amed_label
from shapely.geometry import shape

P = dict(hi=0.78, plateau_weeks_min=6, peak_min=0.85, start=((12,10),(1,25)), end=((2,10),(3,20)), apr_max=0.38)
def despike(series):
    """Drop single-scene outliers (haze/shadow/bad cloud mask): a scene is removed if its NDVI or NDYI differs from the median of its
    4 neighbouring scenes by more than 0.15 / 0.20, or NDYI > 0.80 (physically implausible for vegetation)."""
    s=sorted(series,key=lambda x:x['d']); out=[]
    for i,x in enumerate(s):
        nb=[s[j] for j in range(max(0,i-2),min(len(s),i+3)) if j!=i]
        if len(nb)>=3:
            mn=float(np.median([y['ndvi'] for y in nb])); my=float(np.median([y['ndyi'] for y in nb]))
            if abs(x['ndvi']-mn)>0.15 or abs(x['ndyi']-my)>0.20: continue
        if x['ndyi']>0.80: continue
        out.append(x)
    return out
def weekly(series, y0):
    series=despike(series)
    grid=[date(y0,10,1)+timedelta(days=7*i) for i in range(31)]
    return grid, interp(series,'ndvi',grid), interp(series,'ndyi',grid)
def features(series, y0=2025, hi=P['hi']):
    grid,nd,yy=weekly(series,y0)
    if nd is None: return None
    idx=[i for i,x in enumerate(nd) if x>=hi]
    if not idx: return dict(plateau_w=0,peak=float(nd.max()),first=None,last=None,apr=float(np.mean([nd[i] for i,d in enumerate(grid) if d>=date(y0+1,4,1)] or [np.nan])),ndyi_max=float('nan'))
    # longest consecutive run >= hi
    best=cur=0; st=bs=0
    for i,x in enumerate(nd):
        if x>=hi:
            if cur==0: st=i
            cur+=1
            if cur>best: best,bs=cur,st
        else: cur=0
    first,last=grid[bs],grid[bs+best-1]
    fm=[yy[i] for i,d in enumerate(grid) if date(y0+1,1,1)<=d<=date(y0+1,2,28)]
    return dict(plateau_w=best,peak=float(nd.max()),first=first,last=last,
                apr=float(np.mean([nd[i] for i,d in enumerate(grid) if d>=date(y0+1,4,1)])),ndyi_max=float(np.max(fm)) if fm else float('nan'))
def passes(f, y0=2025, p=P):
    if not f or f['first'] is None: return False
    s0=date(y0,*p['start'][0]) if p['start'][0][0]>=10 else date(y0+1,*p['start'][0]); s1=date(y0+1,*p['start'][1])
    e0=date(y0+1,*p['end'][0]); e1=date(y0+1,*p['end'][1])
    return (f['plateau_w']>=p['plateau_weeks_min'] and f['peak']>=p['peak_min'] and s0<=f['first']<=s1 and e0<=f['last']<=e1 and f['apr']<=p['apr_max'])
if __name__=='__main__':
    y0=int(sys.argv[3]) if len(sys.argv)>3 else 2025
    if sys.argv[1].startswith('REF'):
        ref=json.load(open('ref_commons_fennel_2020.json'))['series']; f=features(ref,2019); print('reference features',f,'| passes own rule:',passes(f,2019)); sys.exit()
    d=json.load(open(sys.argv[1])); rows=[]
    for fid,v in d.items():
        if len(v['series'])<10: continue
        f=features(v['series'],y0)
        if not f or np.isnan(f['apr']): continue
        f.update(id=fid,area=v['area'],cell=v['cell'],amed=amed_label(v['seasons'])); c=shape(v['geometry']).centroid; f['lat']=round(c.y,5); f['lon']=round(c.x,5); rows.append(f)
    cand=[f for f in rows if passes(f,y0)]
    print(f'fields {len(rows)} | rule-v1 candidates {len(cand)} = {100*len(cand)/len(rows):.1f}% of fields, {100*sum(f["area"] for f in cand)/sum(f["area"] for f in rows):.1f}% of area')
    print(' AMED among candidates:',dict(collections.Counter(f['amed'] for f in cand).most_common(6)))
    print(' AMED among all       :',dict(collections.Counter(f['amed'] for f in rows).most_common(6)))
    pw=collections.Counter(min(f['plateau_w'],12) for f in rows); print(' plateau-weeks(>=.78) histogram:',dict(sorted(pw.items())))
    def ser(o): return {k:(str(v) if isinstance(v,date) else v) for k,v in o.items()}
    json.dump([ser(f) for f in cand],open(sys.argv[2],'w'))
