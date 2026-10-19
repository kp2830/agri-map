"""Apply a phenology rule to full-belt series; print stats, AMED cross-tab, and write candidates.
usage: candidates.py <series_all.json> <out_candidates.json> [rule-json]"""
import sys, json, collections, numpy as np
from datetime import date
from analyze_series import feats
from shapely.geometry import shape

RULE = dict(peak_min=0.50, oct_max=0.30, mar2_min=0.45, apr_min=0.35)
def passes(f, r):
    return f['peak'] >= r['peak_min'] and f['oct'] < r['oct_max'] and f['mar2'] >= r['mar2_min'] and f['apr'] >= r['apr_min']

def amed_label(seasons):
    # AMED top crop for seasons whose window overlaps Oct-2025..Apr-2026 (start in Oct-Jan, end Jan-May 2026)
    import datetime as dt
    labs=[]
    for s in seasons:
        st=dt.datetime.utcfromtimestamp(s['start']); en=dt.datetime.utcfromtimestamp(s['end'])
        if date(2025,10,1)<=st.date()<=date(2026,1,31) and en.date()>=date(2026,1,15) and (s['conf'] or 0)>=0.5:
            labs.append(s['crop'])
    return labs[0] if labs else 'none/low'

if __name__ == '__main__':
    d=json.load(open(sys.argv[1])); r=dict(RULE)
    if len(sys.argv)>3: r.update(json.loads(sys.argv[3]))
    rows=[]
    for fid,v in d.items():
        if not v['series'] or len(v['series'])<10: continue
        f=feats(v['series'])
        if not f or any(np.isnan([f['oct'],f['mar2'],f['apr']])): continue
        f.update(id=fid, area=v['area'], amed=amed_label(v['seasons']), cell=v['cell']); c=shape(v['geometry']).centroid; f['lat']=round(c.y,5); f['lon']=round(c.x,5)
        rows.append(f)
    cand=[f for f in rows if passes(f,r)]
    print(f'usable fields {len(rows)} / {len(d)}; rule {r}')
    print(f'candidates: {len(cand)} = {100*len(cand)/max(1,len(rows)):.1f}% of fields, {100*sum(f["area"] for f in cand)/max(1,sum(f["area"] for f in rows)):.1f}% of area')
    print('AMED label among candidates:', dict(collections.Counter(f['amed'] for f in cand).most_common(8)))
    print('AMED label among ALL:', dict(collections.Counter(f['amed'] for f in rows).most_common(8)))
    rabi=[f for f in rows if f['peak']>=0.45]
    print(f'rabi-green fields (peak>=.45): {len(rabi)}; candidates are {100*len(cand)/max(1,len(rabi)):.1f}% of them')
    json.dump(dict(rule=r,candidates=cand,n_usable=len(rows)),open(sys.argv[2],'w'))
