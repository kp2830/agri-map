"""
Phenological/temporal feature engineering — real, pure math operating on a real per-field time
series of (day_of_year_or_days_since_sowing, value) pairs. Nothing here requires satellite
credentials to build or test; it becomes meaningful the moment real NDVI/NDRE/NDWI/NDYI/VV/VH
time series exist per field (via cdse_client.py once real credentials are configured).

CRITICAL DESIGN POINT (per the founder's requirement to normalize across geography): these
functions operate on RELATIVE time (days since the first observation, or days since a real
sowing date when known) — never on absolute calendar date — so a Slovak field observed
March-September and an Indian Kharif field observed June-October can be compared on "how far
into its own growing season is this field" rather than "what calendar month is it in Europe."
This is what lets a model trained on Slovak trajectories say anything meaningful about an
Indian field's trajectory shape, independent of the two countries' different growing calendars.

No future leakage: every "as-of T" function below takes an explicit `as_of_day` cutoff and
filters observations before computing anything — a T-30 feature set literally cannot see a
T-10 observation, by construction, not by trusting the caller to pre-filter correctly.
"""

from __future__ import annotations

from dataclasses import dataclass

from spectral_indices import mean_ignoring_none, temporal_slope


@dataclass(frozen=True)
class Observation:
    """One real per-field per-date measurement of one index. `days_since_start` is relative to
    the field's own first observation (or sowing date, if known) — never an absolute calendar
    date, per the cross-geography normalization requirement above."""

    days_since_start: float
    value: float | None
    cloud_free: bool = True


def filter_as_of(observations: list[Observation], as_of_day: float) -> list[Observation]:
    """The single no-leakage gate every temporal feature function must pass through: only
    observations at or before `as_of_day`, and only cloud-free ones, ever reach a feature
    calculation. A T-30 prediction literally cannot construct features from anything after
    day (bloom_day - 30) if `as_of_day` is set correctly by the caller."""
    return [o for o in observations if o.days_since_start <= as_of_day and o.cloud_free and o.value is not None]


@dataclass(frozen=True)
class PhenologyFeatures:
    mean: float | None
    slope: float | None
    peak_value: float | None
    peak_day: float | None
    days_since_peak: float | None  # None if no peak yet observed as-of this cutoff
    pre_peak_slope: float | None  # growth rate before the peak (None if peak is the first obs)
    post_peak_slope: float | None  # decline/senescence rate after the peak
    growth_acceleration: float | None  # second-order: change in slope over the first vs second half
    variability: float | None  # standard deviation of real values, a temporal-noise/quality proxy
    observation_count: int


def _std(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    mean = sum(values) / len(values)
    return (sum((v - mean) ** 2 for v in values) / (len(values) - 1)) ** 0.5


def compute_phenology_features(observations: list[Observation], as_of_day: float) -> PhenologyFeatures:
    """The real feature set: mean/slope (already in spectral_indices.py's temporal_slope) plus
    peak-relative and shape features that distinguish "still growing" from "past peak and
    senescing" — the actual phenological information a single mean/slope pair discards. Every
    sub-feature independently degrades to None (never 0) when there isn't enough real data to
    compute it, rather than guessing."""
    obs = filter_as_of(observations, as_of_day)
    n = len(obs)
    if n == 0:
        return PhenologyFeatures(None, None, None, None, None, None, None, None, None, 0)

    values = [o.value for o in obs]  # type: ignore[misc]  # filter_as_of already excludes None
    days = [o.days_since_start for o in obs]

    mean = mean_ignoring_none(values)
    slope = temporal_slope(days, values)
    variability = _std(values)

    peak_idx = max(range(n), key=lambda i: values[i])
    peak_value = values[peak_idx]
    peak_day = days[peak_idx]
    days_since_peak = as_of_day - peak_day if peak_idx < n - 1 or as_of_day > peak_day else None

    pre_peak = [(d, v) for d, v in zip(days, values) if d <= peak_day]
    post_peak = [(d, v) for d, v in zip(days, values) if d >= peak_day]
    pre_peak_slope = temporal_slope([d for d, _ in pre_peak], [v for _, v in pre_peak]) if len(pre_peak) >= 2 else None
    post_peak_slope = temporal_slope([d for d, _ in post_peak], [v for _, v in post_peak]) if len(post_peak) >= 2 else None

    growth_acceleration = None
    if n >= 4:
        mid = n // 2
        first_half_slope = temporal_slope(days[:mid], values[:mid])
        second_half_slope = temporal_slope(days[mid:], values[mid:])
        if first_half_slope is not None and second_half_slope is not None:
            growth_acceleration = second_half_slope - first_half_slope

    return PhenologyFeatures(
        mean=mean,
        slope=slope,
        peak_value=peak_value,
        peak_day=peak_day,
        days_since_peak=days_since_peak,
        pre_peak_slope=pre_peak_slope,
        post_peak_slope=post_peak_slope,
        growth_acceleration=growth_acceleration,
        variability=variability,
        observation_count=n,
    )


def normalize_by_season_fraction(observations: list[Observation], season_length_days: float) -> list[Observation]:
    """Cross-geography normalization: rescales `days_since_start` into a 0..1 fraction of the
    field's own (real or reasonably estimated) season length, so a Slovak sunflower's day-60
    observation and an Indian Kharif sunflower's day-60 observation are comparable by
    "fraction of season elapsed" rather than by raw day count, when season lengths genuinely
    differ. Only applied when `season_length_days` is a real, positive value — never guessed
    from thin air; the caller is responsible for supplying a defensible estimate (e.g. the
    real gap between a field's own first and last observation, or a real sowing-to-harvest
    span when dates are known)."""
    if season_length_days <= 0:
        raise ValueError("season_length_days must be a real, positive value — never fabricated")
    return [Observation(o.days_since_start / season_length_days, o.value, o.cloud_free) for o in observations]
