"""One-shot template matching: rank belt fields by shape-similarity (NDVI+NDRE, shift-tolerant) to the confirmed fennel reference curve.
usage: template_match.py <series_all.json> <season_start_year> <out.json> [shift_min_weeks shift_max_weeks]"""
import sys, json, numpy as np, collections
from datetime import date, timedelta
from rule_v1 import despike, features, passes
from analyze_series import interp
from candidates import amed_label
from shapely.geometry import shape
def curves(series,y0):
    s=despike(series); g=[date(y0,10,1)+timedelta(days=7*i) for i in range(31)]
    return g, interp(s,'ndvi',g), interp(s,'ndre',g)
REF=json.load(open('ref_commons_fennel_2020.json'))['series']
_,Rn,Rr=curves(REF,2019)
LO,HI=(int(sys.argv[4]),int(sys.argv[5])) if len(sys.argv)>5 else (-3,8)
def dist(nd,re):
    best=(9,0)
    for sft in range(LO,HI+1):
        # compare field week i with reference week i-sft over reference weeks 8..26 (late Nov..early Apr)
        errs=[]
        for t in range(8,27):
            j=t+sft
            if 0<=j<31: errs.append((nd[j]-Rn[t])**2+(re[j]-Rr[t])**2)
        if len(errs)>=15:
            d=float(np.sqrt(np.mean(errs)))
            if d<best[0]: best=(d,sft)
    return best
if __name__=='__main__':
    d=json.load(open(sys.argv[1])); y0=int(sys.argv[2]); rows=[]
    for fid,v in d.items():
        if len(v['series'])<8: continue
        g,nd,re=curves(v['series'],y0)
        if nd is None or re is None: continue
        dd,sft=dist(nd,re); f=features(despike(v['series']),y0); c=shape(v['geometry']).centroid
        rows.append(dict(id=fid,dist=round(dd,3),shift_w=sft,amed=amed_label(v['seasons']) if y0>=2025 else 'n/a',rule=bool(passes(f,y0)) if f else False,lat=round(c.y,5),lon=round(c.x,5),area_ha=round(v['area']/1e4,2)))
    rows.sort(key=lambda r:r['dist'])
    top=rows[:40]
    print(f'{len(rows)} fields; best distances: {[r["dist"] for r in rows[:10]]}; median {np.median([r["dist"] for r in rows]):.3f}')
    print(f' top-40: pass rule v1 = {sum(r["rule"] for r in top)}; shift weeks counter {dict(collections.Counter(r["shift_w"] for r in top).most_common(5))}; AMED {dict(collections.Counter(r["amed"] for r in top).most_common(5))}')
    cl=collections.defaultdict(int)
    for r in top: cl[(round(r['lat']*35)/35,round(r['lon']*35)/35)]+=1
    print(' top-40 spatial clusters (~3 km):',sorted(cl.values(),reverse=True)[:8])
    json.dump(rows[:200],open(sys.argv[3],'w'))
