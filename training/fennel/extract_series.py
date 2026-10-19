"""CDSE Sentinel-2 time series (NDVI/NDRE/NDYI per scene) for sampled belt fields.
usage: extract_series.py <pool.json> <out.json> <n> <season_start YYYY-MM-DD> <season_end YYYY-MM-DD> [seed]"""
import sys, json, random, time, threading
from datetime import date
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, '/Users/kavyapatni/Desktop/agri-map/training/sunflower')
import requests
import cdse_client
from cdse_client import SPECTRAL_INDICES_EVALSCRIPT, request_polygon_statistics

_tok = {'v': None, 't': 0}
_tl = threading.Lock()
_orig = cdse_client.get_access_token
def _cached():
    with _tl:
        if _tok['v'] is None or time.time() - _tok['t'] > 480:
            _tok['v'] = _orig(); _tok['t'] = time.time()
        return _tok['v']
cdse_client.get_access_token = _cached

pool, out, n, d0, d1 = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
seed = int(sys.argv[6]) if len(sys.argv) > 6 else 7
F = [f for f in json.load(open(pool))['fields'] if f['areaSqM'] >= 4000]
random.Random(seed).shuffle(F); F = F[:n]
y0, m0, dd0 = map(int, d0.split('-')); y1, m1, dd1 = map(int, d1.split('-'))
res = {}; lock = threading.Lock(); done = [0]

def one(f):
    for k in range(6):
        try:
            r = request_polygon_statistics(f['geometry'], date(y0, m0, dd0), date(y1, m1, dd1), SPECTRAL_INDICES_EVALSCRIPT)
            ser = []
            for it in r.response.get('data', []):
                o = it['outputs']; row = {'d': it['interval']['from'][:10]}; ok = True
                for ix in ('ndvi', 'ndre', 'ndyi'):
                    st = o[ix]['bands']['B0']['stats']
                    if st.get('sampleCount', 0) - st.get('noDataCount', 0) < 3 or not isinstance(st.get('mean'), (int, float)): ok = False; break
                    row[ix] = round(st['mean'], 3)
                if ok: ser.append(row)
            return ser
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code == 429: time.sleep(15 * (k + 1)); continue
            print('http', e.response.status_code if e.response is not None else None, flush=True); return None
        except Exception as ex:
            print('err', type(ex).__name__, str(ex)[:120], flush=True); time.sleep(5)
    return None

def work(f):
    s = one(f)
    with lock:
        res[f['id']] = {'cell': f['cell'], 'area': f['areaSqM'], 'seasons': f['seasons'], 'geometry': f['geometry'], 'series': s}
        done[0] += 1
        if done[0] % 25 == 0:
            print(f'{done[0]}/{len(F)}', flush=True); json.dump(res, open(out, 'w'))
    time.sleep(0.6)

with ThreadPoolExecutor(3) as ex: list(ex.map(work, F))
json.dump(res, open(out, 'w')); print('DONE', len(res), 'ok', sum(1 for v in res.values() if v['series']))
