"""
Same real decode logic as decode_result.py, but emits a single-line JSON object on stdout
(instead of human-readable prints) so it can be called as a subprocess from the Node/TypeScript
research integration (server/src/services/agricultural/worldcereal/geotiffDecoder.ts).

Exists because the pure-JS `geotiff` npm package (v3.0.5, latest as of this writing) fails to
parse the real GDAL/openEO-generated multi-band uint8 GeoTIFFs WorldCereal returns (confirmed:
its IFD tag parser resolves zero fields for these files -- a real upstream limitation, not
something worth working around with more JS). rasterio (Python, GDAL-backed) has no such
problem, so decoding stays in Python for now; job submission/polling is pure TypeScript (see
openeoClient.ts) since that only needed plain REST calls.

Usage: python3 decode_for_node.py <tif_path> <lat> <lng> [window_radius_px]
"""
import sys
import json
import rasterio
import numpy as np
from rasterio.warp import transform

CLASSES = ['wheat','barley','rye','oats','maize','sorghum','rice','other_temporary_crops',
           'millet','vegetables','beet','dry_pulses_legumes','sunflower','soy_soybeans',
           'rapeseed_rape','other_oilseed','groundnuts','fibre_crops','potatoes','cassava',
           'tobacco','grass_fodder_crops','sugar_cane','no_crop']


def decode(tif_path: str, lat: float, lng: float, window_radius: int = 5) -> dict:
    with rasterio.open(tif_path) as src:
        data = src.read()
        xs, ys = transform("EPSG:4326", src.crs, [lng], [lat])
        crow, ccol = src.index(xs[0], ys[0])
        cls = data[0]
        px_size_m = abs(src.transform.a)

        r0, r1 = max(0, crow - window_radius), min(cls.shape[0], crow + window_radius + 1)
        c0, c1 = max(0, ccol - window_radius), min(cls.shape[1], ccol + window_radius + 1)
        window_cls = cls[r0:r1, c0:c1]
        valid = window_cls != 254
        valid_count = int(valid.sum())
        total_count = int(window_cls.size)

        result = {
            "validPixelCount": valid_count,
            "totalPixelCount": total_count,
            "nearestValidPixel": None,
        }
        if valid_count == 0:
            return result

        rows, cols = np.where(valid)
        dists = (rows - (crow - r0)) ** 2 + (cols - (ccol - c0)) ** 2
        i = np.argmin(dists)
        r, c = r0 + rows[i], c0 + cols[i]
        code = int(cls[r, c])
        class_probs = {CLASSES[k]: int(data[2 + k, r, c]) for k in range(len(CLASSES))}
        result["nearestValidPixel"] = {
            "topClass": CLASSES[code],
            "topClassProbabilityPct": int(data[1, r, c]),
            "classProbabilitiesPct": class_probs,
            "distanceFromRequestedPointMeters": float(np.sqrt(dists[i]) * px_size_m),
        }
        return result


if __name__ == "__main__":
    tif_path, lat, lng = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    window_radius = int(sys.argv[4]) if len(sys.argv) > 4 else 5
    print(json.dumps(decode(tif_path, lat, lng, window_radius)))
