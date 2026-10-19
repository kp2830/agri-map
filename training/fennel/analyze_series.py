import sys, json, numpy as np, collections
from datetime import date, timedelta
def interp(series, key, grid):
    pts=[(date.fromisoformat(s['d']), s[key]) for s in series if key in s]
    if len(pts)<8: return None
    pts.sort(); xs=np.array([(d-grid[0]).days for d,_ in pts]); ys=np.array([v for _,v in pts])
    return np.interp([(g-grid[0]).days for g in grid], xs, ys)
def feats(series, y0=2025):
    grid=[date(y0,10,1)+timedelta(days=7*i) for i in range(31)]  # Oct 1 .. ~Apr 29
    nd=interp(series,'ndvi',grid); yy=interp(series,'ndyi',grid)
    if nd is None: return None
    g=lambda a,b,arr=nd: float(np.mean([arr[i] for i,d in enumerate(grid) if date(*a)<=d<=date(*b)] or [np.nan]))
    y=y0
    f=dict(oct=g((y,10,1),(y,11,10)), dec=g((y,12,1),(y,12,31)), jan=g((y+1,1,1),(y+1,1,31)), feb=g((y+1,2,1),(y+1,2,28)),
           mar1=g((y+1,3,1),(y+1,3,15)), mar2=g((y+1,3,16),(y+1,3,31)), apr=g((y+1,4,1),(y+1,4,29)),
           peak=float(nd.max()), peak_date=str(grid[int(nd.argmax())]), ndyi_fm=float(np.nanmax(yy[[i for i,d in enumerate(grid) if date(y+1,2,1)<=d<=date(y+1,3,31)]])) if yy is not None else np.nan)
    # end of season: first date after peak where NDVI < 0.3 and stays
    pk=int(nd.argmax()); end=None
    for i in range(pk,len(grid)):
        if nd[i]<0.30 and all(nd[j]<0.33 for j in range(i,min(i+2,len(grid)))): end=grid[i]; break
    f['end']=str(end) if end else 'after_Apr'
    return f
if __name__=='__main__':
    d=json.load(open(sys.argv[1])); rows=[]
    for fid,v in d.items():
        if not v['series']: continue
        f=feats(v['series']);
        if f: f['id']=fid; f['amed']=v['seasons']; rows.append(f)
    print('fields with usable series:',len(rows),'of',len(d))
    ends=collections.Counter()
    for r in rows:
        e=r['end']; ends['after_Apr' if e=='after_Apr' else e[:7]+('a' if int(e[8:])<=15 else 'b')]+=1
    print('season-end half-month distribution:',dict(sorted(ends.items())))
    late=[r for r in rows if r['peak']>=0.5 and r['oct']<0.30 and (r['mar2']>=0.45) and r['apr']>=0.35]
    print('late-retention candidates (peak>=.5, oct<.30, mar2>=.45, apr>=.35):',len(late),'=',round(100*len(late)/len(rows),1),'%')
    json.dump(rows,open(sys.argv[1].replace('.json','_feats.json'),'w'))
