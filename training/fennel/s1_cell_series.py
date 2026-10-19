"""Sentinel-1 VV/VH (gamma0 terrain-corrected, dB) per-field series for a belt pool via per-cell chips.
usage: s1_cell_series.py <pool.json> <out.json> <start> <end> [only_orbit]"""
import sys, json, math, collections, threading, numpy as np
sys.path.insert(0,'/Users/kavyapatni/Desktop/agri-map/training/fennel')
from concurrent.futures import ThreadPoolExecutor
from shapely.geometry import shape
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from s1_tools import s1_dates, s1_chip
pool,out,d0,d1=sys.argv[1:5]; only=sys.argv[5] if len(sys.argv)>5 else None
P=json.load(open(pool))['fields']; cells=collections.defaultdict(list)
for f in P:
    if f['areaSqM']>=3000: cells[f['cell']].append(f)
res={}; lock=threading.Lock()
for ci,(tok,fs) in enumerate(cells.items()):
    geoms=[shape(f['geometry']) for f in fs]
    bbox=[min(g.bounds[0] for g in geoms)-0.0002,min(g.bounds[1] for g in geoms)-0.0002,max(g.bounds[2] for g in geoms)+0.0002,max(g.bounds[3] for g in geoms)+0.0002]
    latm=(bbox[1]+bbox[3])/2
    w=int(min(2400,max(8,math.ceil((bbox[2]-bbox[0])*111320*math.cos(math.radians(latm))/10)))); h=int(min(2400,max(8,math.ceil((bbox[3]-bbox[1])*110540/10))))
    tr=from_bounds(*bbox,w,h); masks=[rasterize([(g,1)],out_shape=(h,w),transform=tr,fill=0,dtype='uint8').astype(bool) for g in geoms]
    acq=[a for a in s1_dates(bbox,d0,d1) if (not only or (a[1] or '').lower()==only)]
    print(f'cell {ci+1}/{len(cells)} {tok} fields={len(fs)} acquisitions={len(acq)}',flush=True)
    ser={f['id']:[] for f in fs}
    def do(a):
        ts,orb,_=a
        try: c=s1_chip(bbox,ts,w,h)
        except Exception as e: print('chipfail',ts,str(e)[:60],flush=True); return
        for f,m in zip(fs,masks):
            ok=m&(c[2]>0.5)&np.isfinite(c[0])&np.isfinite(c[1])
            if ok.sum()>=3 and ok.sum()>=0.5*m.sum():
                vv=10*math.log10(max(float(c[0][ok].mean()),1e-4)); vh=10*math.log10(max(float(c[1][ok].mean()),1e-5))
                with lock: ser[f['id']].append({'d':ts[:10],'orb':orb,'vv':round(vv,2),'vh':round(vh,2)})
    with ThreadPoolExecutor(4) as ex: list(ex.map(do,acq))
    for f in fs: res[f['id']]={'cell':tok,'series':sorted(ser[f['id']],key=lambda x:x['d'])}
    json.dump(res,open(out,'w'))
print('DONE',len(res))
