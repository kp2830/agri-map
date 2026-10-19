"""Gujarat fennel hypothesis v0 (NOT validated; no confirmed Gujarat fennel field exists yet):
low NDVI around sowing (20 Oct-10 Nov), green Jan 15-Feb 15, still green 20 Mar-10 Apr, and green-in-Oct fields excluded (castor/fodder/perennial-like).
usage: rule_gujarat_v0.py <series_all.json> <out_candidates.json> [csv]"""
import sys, json, csv, collections, numpy as np
from datetime import date, timedelta
from rule_v1 import despike
from analyze_series import interp
from candidates import amed_label
from shapely.geometry import shape
grid=[date(2025,10,1)+timedelta(days=7*i) for i in range(31)]
def win(nd,a,b): return float(np.mean(nd[[i for i,g in enumerate(grid) if a<=g<=b]]))
d=json.load(open(sys.argv[1])); rows=[]
for fid,v in d.items():
    if len(v['series'])<10: continue
    nd=interp(despike(v['series']),'ndvi',grid)
    if nd is None: continue
    c=shape(v['geometry']).centroid
    rows.append(dict(id=fid,amed=amed_label(v['seasons']),area=v['area'],lat=round(c.y,5),lon=round(c.x,5),
      oct=win(nd,date(2025,10,20),date(2025,11,10)),jf=win(nd,date(2026,1,15),date(2026,2,15)),lm=win(nd,date(2026,3,20),date(2026,4,10)),
      a2=win(nd,date(2026,4,20),date(2026,4,29)),mar=win(nd,date(2026,3,1),date(2026,3,10)),nd=nd.tolist()))
G=[r for r in rows if r['oct']<=0.35 and r['jf']>=0.5 and r['lm']>=0.45]
base=collections.Counter(r['amed'] for r in rows); gc=collections.Counter(r['amed'] for r in G)
print(f"fields {len(rows)} | Gujarat-v0 candidates {len(G)} = {100*len(G)/len(rows):.1f}% fields, {100*sum(r['area'] for r in G)/sum(r['area'] for r in rows):.1f}% area")
print('AMED label: all vs candidates (enrichment = cand share / all share):')
for k,n in base.most_common(7):
    ca=gc.get(k,0); print(f"   {k:14s} all {n:5d} ({100*n/len(rows):4.1f}%)  cand {ca:3d} ({100*ca/max(1,len(G)):4.1f}%)  x{(ca/max(1,len(G)))/(n/len(rows)):.1f}")
re_green=[r for r in G if r['mar']<r['lm']-0.05 or r['a2']>=0.45]
print(f"candidates that RE-GREEN after a March dip or are green again on 20-29 Apr (likely a 2nd summer crop, not fennel): {len(re_green)}")
grid2=collections.defaultdict(list)
for r in G: grid2[(round(r['lat']*35)/35,round(r['lon']*35)/35)].append(r)
clean=[r for r in G if r not in re_green]
print(f"clean subset (no re-greening): {len(clean)}; AMED:",dict(collections.Counter(r['amed'] for r in clean).most_common(5)))
print(f'spatial clusters (~3 km): {len(grid2)}; biggest:',sorted([len(v) for v in grid2.values()],reverse=True)[:8])
json.dump([{k:v for k,v in r.items() if k!='nd'} for r in G],open(sys.argv[2],'w'))
if len(sys.argv)>3:
    with open(sys.argv[3],'w',newline='') as fh:
        w=csv.writer(fh); w.writerow(['field_id','lat','lon','area_ha','amed_2025_26','ndvi_sowing_window','ndvi_janfeb','ndvi_20mar_10apr','regreen_flag','to_verify'])
        for r in sorted(G,key=lambda x:(round(x['lat'],2),round(x['lon'],2))): w.writerow([r['id'],r['lat'],r['lon'],round(r['area']/1e4,2),r['amed'],round(r['oct'],2),round(r['jf'],2),round(r['lm'],2),'REGREEN (likely 2nd crop)' if (r['mar']<r['lm']-0.05 or r['a2']>=0.45) else 'clean','crop? sowing month? bloom colour?'])
