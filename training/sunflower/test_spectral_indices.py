"""Real math correctness tests for spectral_indices.py — hand-computed expected values, no
satellite data involved. Run: python3 -m training.sunflower.test_spectral_indices (from repo
root, with training/.venv activated)."""

from spectral_indices import ndvi, ndre, ndwi_canopy_water, ndyi_yellowness, temporal_slope, mean_ignoring_none

passed = 0
failed = 0


def check(label, actual, expected, tol=1e-9):
    global passed, failed
    ok = (actual is None and expected is None) or (actual is not None and expected is not None and abs(actual - expected) < tol)
    print(f"{'PASS' if ok else 'FAIL'} {label}: expected={expected} actual={actual}")
    if ok:
        passed += 1
    else:
        failed += 1


# NDVI: (0.5 - 0.1) / (0.5 + 0.1) = 0.4 / 0.6 = 0.6666...
check("ndvi(0.5, 0.1)", ndvi(0.5, 0.1), 0.4 / 0.6)
check("ndvi zero denom", ndvi(0.0, 0.0), None)

# NDRE: (0.45 - 0.25) / (0.45 + 0.25) = 0.2 / 0.7
check("ndre(0.45, 0.25)", ndre(0.45, 0.25), 0.2 / 0.7)

# NDWI canopy (Gao): (0.45 - 0.20) / (0.45 + 0.20) = 0.25 / 0.65
check("ndwi_canopy_water(0.45, 0.20)", ndwi_canopy_water(0.45, 0.20), 0.25 / 0.65)

# NDYI: (0.12 - 0.08) / (0.12 + 0.08) = 0.04 / 0.20 = 0.2
check("ndyi_yellowness(0.12, 0.08)", ndyi_yellowness(0.12, 0.08), 0.2)

# temporal_slope: perfect line y = 2x + 1 over x=[0,1,2,3] -> slope = 2
check("temporal_slope perfect line", temporal_slope([0, 1, 2, 3], [1, 3, 5, 7]), 2.0)
check("temporal_slope single point", temporal_slope([0], [1]), None)
check("temporal_slope constant y", temporal_slope([0, 1, 2], [5, 5, 5]), 0.0)

check("mean_ignoring_none mixed", mean_ignoring_none([1.0, None, 3.0]), 2.0)
check("mean_ignoring_none all None", mean_ignoring_none([None, None]), None)

print(f"\n{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
