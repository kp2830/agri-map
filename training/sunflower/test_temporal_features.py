"""Correctness tests for temporal_features.py using a hand-constructed synthetic NDVI-shaped
trajectory (real math verification only — never presented as real satellite data)."""

from temporal_features import Observation, compute_phenology_features, filter_as_of, normalize_by_season_fraction

passed = 0
failed = 0


def check(label, actual, expected, tol=1e-6):
    global passed, failed
    ok = (actual is None and expected is None) or (actual is not None and expected is not None and abs(actual - expected) < tol)
    print(f"{'PASS' if ok else 'FAIL'} {label}: expected={expected} actual={actual}")
    if ok:
        passed += 1
    else:
        failed += 1


# A hand-constructed bell-shaped trajectory: rises to a peak at day 60, then declines —
# mimicking the SHAPE of a real vegetation index curve, used only to verify the math finds the
# peak/slopes correctly, not as a claim about real Sunflower values.
obs = [
    Observation(days_since_start=0, value=0.2),
    Observation(days_since_start=20, value=0.4),
    Observation(days_since_start=40, value=0.6),
    Observation(days_since_start=60, value=0.8),  # peak
    Observation(days_since_start=80, value=0.5),
    Observation(days_since_start=100, value=0.3),
]

print("=== 1. No-leakage filter: as_of_day=45 excludes everything after day 45 ===")
filtered = filter_as_of(obs, 45)
check("count", len(filtered), 3)
check("last day included", filtered[-1].days_since_start, 40)

print("\n=== 2. Full trajectory: peak correctly identified at day 60, value 0.8 ===")
features = compute_phenology_features(obs, as_of_day=100)
check("peak_value", features.peak_value, 0.8)
check("peak_day", features.peak_day, 60)
check("observation_count", features.observation_count, 6)
check("pre_peak_slope positive (still growing before peak)", features.pre_peak_slope > 0, True)
check("post_peak_slope negative (senescing after peak)", features.post_peak_slope < 0, True)

print("\n=== 3. As-of day=50 (before peak, T-10-style cutoff): must not see the peak or decline ===")
early_features = compute_phenology_features(obs, as_of_day=50)
check("observation_count (only days 0,20,40)", early_features.observation_count, 3)
check("peak_value is just the max seen so far (0.6, not 0.8 — no future leakage)", early_features.peak_value, 0.6)
check("slope still positive (growth phase only)", early_features.slope > 0, True)

print("\n=== 4. Zero observations -> everything None, never fabricated ===")
empty_features = compute_phenology_features([], as_of_day=50)
check("mean", empty_features.mean, None)
check("peak_value", empty_features.peak_value, None)
check("observation_count", empty_features.observation_count, 0)

print("\n=== 5. Season-fraction normalization ===")
normalized = normalize_by_season_fraction(obs, season_length_days=100)
check("day 60 -> fraction 0.6", normalized[3].days_since_start, 0.6)
try:
    normalize_by_season_fraction(obs, season_length_days=0)
    print("FAIL: should have raised on non-positive season length")
    failed += 1
except ValueError:
    print("PASS: correctly rejects a non-positive season length rather than dividing by zero/guessing")
    passed += 1

print(f"\n{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
