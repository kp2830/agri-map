"""Sentinel-1 GRD helpers (CDSE Sentinel Hub): per-date VV/VH chips (sigma0, orthorectified) over a bbox."""
import sys, json, math, numpy as np
sys.path.insert(0, '/Users/kavyapatni/Desktop/agri-map/training/fennel')
from cell_series import post
from rasterio.io import MemoryFile
EVAL_S1 = """//VERSION=3
function setup(){return{input:["VV","VH","dataMask"],output:{bands:3,sampleType:"FLOAT32"}}}
function evaluatePixel(s){return [s.VV,s.VH,s.dataMask]}"""
def s1_dates(bbox, d0, d1):
    body={'collections':['sentinel-1-grd'],'datetime':f'{d0}T00:00:00Z/{d1}T23:59:59Z','bbox':bbox,'limit':100,'fields':{'include':['properties.datetime','properties.sat:orbit_state','properties.s1:polarization'] }}
    r=post('https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search',body).json()
    out=[]
    for f in r['features']:
        p=f['properties']; out.append((p['datetime'][:19],p.get('sat:orbit_state'),p.get('s1:polarization')))
    return sorted(out)
def s1_chip(bbox, ts, w, h, orbit=None):
    day=ts[:10]
    dfil={'timeRange':{'from':f'{day}T00:00:00Z','to':f'{day}T23:59:59Z'},'acquisitionMode':'IW','polarization':'DV','resolution':'HIGH'}
    if orbit: dfil['orbitDirection']=orbit.upper()
    body={'input':{'bounds':{'bbox':bbox},'data':[{'type':'sentinel-1-grd','dataFilter':dfil,'processing':{'orthorectify':True,'backCoeff':'GAMMA0_TERRAIN','demInstance':'COPERNICUS_30','speckleFilter':{'type':'LEE','windowSizeX':3,'windowSizeY':3}}}]},
          'output':{'width':w,'height':h,'responses':[{'identifier':'default','format':{'type':'image/tiff'}}]},'evalscript':EVAL_S1}
    r=post('https://sh.dataspace.copernicus.eu/api/v1/process',body)
    with MemoryFile(r.content) as mf:
        with mf.open() as ds: return ds.read()
