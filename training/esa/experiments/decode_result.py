"""
Decodes a WorldCereal CROPTYPE GeoTIFF result and reports the classification + full
per-class probability vector for the real field location the job was run for, plus a small
neighborhood summary (never cherry-picking a single favorable pixel).
"""
import sys
import rasterio
import numpy as np
from rasterio.warp import transform

CLASSES = ['wheat','barley','rye','oats','maize','sorghum','rice','other_temporary_crops',
           'millet','vegetables','beet','dry_pulses_legumes','sunflower','soy_soybeans',
           'rapeseed_rape','other_oilseed','groundnuts','fibre_crops','potatoes','cassava',
           'tobacco','grass_fodder_crops','sugar_cane','no_crop']


def decode(tif_path: str, lat: float, lng: float, window_radius: int = 5) -> None:
    with rasterio.open(tif_path) as src:
        data = src.read()
        xs, ys = transform("EPSG:4326", src.crs, [lng], [lat])
        crow, ccol = src.index(xs[0], ys[0])
        cls = data[0]

        r0, r1 = max(0, crow - window_radius), crow + window_radius + 1
        c0, c1 = max(0, ccol - window_radius), ccol + window_radius + 1
        window_cls = cls[r0:r1, c0:c1]
        valid = window_cls != 254
        print(f"Field: ({lat}, {lng})  window: {window_radius*2+1}x{window_radius*2+1} px around centroid")
        vals, counts = np.unique(window_cls[valid], return_counts=True)
        for v, c in sorted(zip(vals, counts), key=lambda x: -x[1]):
            print(f"  {CLASSES[v]:24s} {c} px")
        sunflower_band = data[2 + CLASSES.index("sunflower")]
        window_sun = sunflower_band[r0:r1, c0:c1]
        print(f"  sunflower probability in window: min={window_sun[valid].min()} max={window_sun[valid].max()} mean={window_sun[valid].mean():.1f}%")

        # nearest real cropland (non-no_crop) pixel to the exact centroid
        rows, cols = np.where(valid & (window_cls != CLASSES.index("no_crop")))
        if len(rows):
            dists = (rows - window_radius) ** 2 + (cols - window_radius) ** 2
            i = np.argmin(dists)
            r, c = r0 + rows[i], c0 + cols[i]
            code = int(cls[r, c])
            print(f"  nearest real cropland pixel: {CLASSES[code]} (overall prob {int(data[1, r, c])}%)")
            probs = {CLASSES[k]: int(data[2 + k, r, c]) for k in range(len(CLASSES))}
            top = sorted(probs.items(), key=lambda x: -x[1])[:5]
            print("  top-5 class probabilities there:", top)


if __name__ == "__main__":
    decode(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]))
