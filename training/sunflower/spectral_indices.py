"""
Real, published vegetation/SAR index formulas — the Python-side mirror of
server/src/services/agricultural/sunflower/spectralIndices.ts, kept deliberately consistent so
training-time and inference-time features are computed identically. Pure math; correct
regardless of whether real satellite reflectance values exist yet (see prepare_dataset.py for
why they mostly don't today). See the TypeScript file's docstrings for full citations —
repeated here only briefly so this file is self-contained.

All reflectance inputs are calibrated surface reflectance in [0, 1].
"""

from __future__ import annotations

from typing import Optional, Sequence


def ndvi(nir: float, red: float) -> Optional[float]:
    """Rouse et al. 1974. Sentinel-2: NIR=B8, Red=B4."""
    denom = nir + red
    return None if denom == 0 else (nir - red) / denom


def ndre(nir: float, red_edge: float) -> Optional[float]:
    """Barnes et al. 2000. Sentinel-2: NIR=B8/B8A, RedEdge=B5."""
    denom = nir + red_edge
    return None if denom == 0 else (nir - red_edge) / denom


def ndwi_canopy_water(nir: float, swir: float) -> Optional[float]:
    """Gao 1996 canopy-water-content variant (NOT the McFeeters open-water formula — see the
    TypeScript sibling for why that distinction matters). Sentinel-2: NIR=B8A, SWIR=B11."""
    denom = nir + swir
    return None if denom == 0 else (nir - swir) / denom


def ndyi_yellowness(green: float, blue: float) -> Optional[float]:
    """Normalized Difference Yellowness Index — published for yellow-flower detection (canola/
    rapeseed bloom-mapping literature), adapted here as the candidate Sunflower yellowness
    feature pending confirmation against the founder's original document."""
    denom = green + blue
    return None if denom == 0 else (green - blue) / denom


def temporal_slope(days_since_first: Sequence[float], values: Sequence[float]) -> Optional[float]:
    """Ordinary least-squares slope of `values` against `days_since_first`. Returns None (not 0)
    for fewer than 2 points — a slope genuinely cannot be computed from one observation."""
    n = len(values)
    if n < 2 or len(days_since_first) != n:
        return None

    mean_x = sum(days_since_first) / n
    mean_y = sum(values) / n

    numerator = sum((x - mean_x) * (y - mean_y) for x, y in zip(days_since_first, values))
    denominator = sum((x - mean_x) ** 2 for x in days_since_first)

    return None if denominator == 0 else numerator / denominator


def mean_ignoring_none(values: Sequence[Optional[float]]) -> Optional[float]:
    real = [v for v in values if v is not None]
    return None if not real else sum(real) / len(real)
