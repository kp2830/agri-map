"""Cheap Sentinel-2 time series for ALL fields of a belt pool: one Process-API chip per (cell, date), zonal means computed locally.
usage: cell_series.py <pool.json> <out.json> <season_start> <season_end> [max_cells] [cell_token_filter]"""
import sys, json, math, time, threading, collections
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, '/Users/kavyapatni/Desktop/agri-map/training/sunflower')
import numpy as np, requests, rasterio
from rasterio.io import MemoryFile
from rasterio.features import rasterize
from shapely.geometry import shape, box
import cdse_client

_tok = {'v': None, 't': 0}; _tl = threading.Lock(); _orig = cdse_client.get_access_token
def token():
    with _tl:
        if _tok['v'] is None or time.time() - _tok['t'] > 480: _tok['v'] = _orig(); _tok['t'] = time.time()
        return _tok['v']

EVAL = """//VERSION=3
function setup(){return{input:["B02","B03","B04","B05","B08","SCL","dataMask"],output:{bands:4,sampleType:"FLOAT32"}}}
function evaluatePixel(s){
  const bad=[0,1,3,8,9,10,11].includes(s.SCL)||s.dataMask==0;
  return [(s.B08-s.B04)/(s.B08+s.B04),(s.B08-s.B05)/(s.B08+s.B05),(s.B03-s.B02)/(s.B03+s.B02),bad?0:1]}"""

def post(url, body, tries=6):
    for k in range(tries):
        try:
            r = requests.post(url, json=body, headers={'Authorization': f'Bearer {token()}'}, timeout=120)
            if r.status_code == 429: time.sleep(10 * (k + 1)); continue
            r.raise_for_status(); return r
        except requests.RequestException as e:
            if k == tries - 1: raise
            time.sleep(5)

def dates_for(bbox, d0, d1):
    out = set(); nxt = None
    body = {'collections': ['sentinel-2-l2a'], 'datetime': f'{d0}T00:00:00Z/{d1}T23:59:59Z', 'bbox': bbox, 'limit': 100,
            'filter': 'eo:cloud_cover < 70', 'filter-lang': 'cql2-text', 'fields': {'include': ['properties.datetime']}}
    r = post('https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search', body).json()
    for f in r['features']: out.add(f['properties']['datetime'][:10])
    return sorted(out)

def chip(bbox, day, w, h):
    body = {'input': {'bounds': {'bbox': bbox}, 'data': [{'type': 'sentinel-2-l2a', 'dataFilter': {'timeRange': {'from': f'{day}T00:00:00Z', 'to': f'{day}T23:59:59Z'}}}]},
            'output': {'width': w, 'height': h, 'responses': [{'identifier': 'default', 'format': {'type': 'image/tiff'}}]}, 'evalscript': EVAL}
    r = post('https://sh.dataspace.copernicus.eu/api/v1/process', body)
    with MemoryFile(r.content) as mf:
        with mf.open() as ds: return ds.read()

if __name__ == '__main__':
    pool, out, d0, d1 = sys.argv[1:5]
    maxc = int(sys.argv[5]) if len(sys.argv) > 5 else 999
    P = json.load(open(pool))['fields']
    cells = collections.defaultdict(list)
    for f in P:
        if f['areaSqM'] >= 3000: cells[f['cell']].append(f)
    result = {}; lock = threading.Lock()
    for ci, (tok, fs) in enumerate(list(cells.items())[:maxc]):
        geoms = [shape(f['geometry']) for f in fs]
        minx = min(g.bounds[0] for g in geoms); miny = min(g.bounds[1] for g in geoms)
        maxx = max(g.bounds[2] for g in geoms); maxy = max(g.bounds[3] for g in geoms)
        bbox = [minx - 0.0002, miny - 0.0002, maxx + 0.0002, maxy + 0.0002]
        latm = (miny + maxy) / 2
        w = int(min(2400, max(8, math.ceil((bbox[2] - bbox[0]) * 111320 * math.cos(math.radians(latm)) / 10))))
        h = int(min(2400, max(8, math.ceil((bbox[3] - bbox[1]) * 110540 / 10))))
        from rasterio.transform import from_bounds
        tr = from_bounds(*bbox, w, h)
        masks = [rasterize([(g, 1)], out_shape=(h, w), transform=tr, fill=0, dtype='uint8').astype(bool) for g in geoms]
        days = dates_for(bbox, d0, d1)
        print(f'cell {ci+1}/{min(maxc,len(cells))} {tok} fields={len(fs)} chip={w}x{h} dates={len(days)}', flush=True)
        ser = {f['id']: [] for f in fs}
        def do(day):
            try: a = chip(bbox, day, w, h)
            except Exception as e: print('chipfail', day, str(e)[:80], flush=True); return
            ndvi, ndre, ndyi, ok = a[0], a[1], a[2], a[3] > 0.5
            for f, m in zip(fs, masks):
                mm = m & ok & np.isfinite(ndvi)
                if mm.sum() >= 3 and mm.sum() >= 0.5 * m.sum():
                    with lock: ser[f['id']].append({'d': day, 'ndvi': round(float(ndvi[mm].mean()), 3), 'ndre': round(float(ndre[mm].mean()), 3), 'ndyi': round(float(ndyi[mm].mean()), 3)})
        with ThreadPoolExecutor(4) as ex: list(ex.map(do, days))
        for f in fs:
            result[f['id']] = {'cell': tok, 'area': f['areaSqM'], 'seasons': f['seasons'], 'geometry': f['geometry'], 'series': sorted(ser[f['id']], key=lambda x: x['d'])}
        json.dump(result, open(out, 'w'))
    print('DONE', len(result))
