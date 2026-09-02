"""
Zero-PU phenology audit: does a shape-only (magnitude-removed) temporal representation reveal a
common Slovak sunflower phenological signature, and does it appear in the 6 real Indian
candidates or distinguish them from the 250 unlabeled Indian AMED target-domain fields? Uses
ONLY already-extracted local raw daily series -- zero new CDSE requests.

Reuses build_observations (pilot_features.py) and normalize_by_season_fraction
(temporal_features.py) verbatim -- not duplicated.

RETROSPECTIVE vs REAL-TIME: every statistic below uses a field's own COMPLETE already-observed
window (exactly what a real map-click would have available the moment that field's full extract
window is collected -- there is no "future" relative to that; this analysis does not simulate
predicting mid-window, so the retrospective/real-time distinction collapses to "use only this
field's own real observations," already satisfied by construction, matching every other script in
this pipeline).

Run: training/.venv/bin/python3 training/sunflower/phenology_transfer_audit.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from pilot_features import build_observations

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
SERVER_SCRIPTS = REPO_ROOT / "server" / "scripts"
INDEX_NAMES = ["ndvi", "ndre", "ndwi", "ndyi"]

# Frozen BEFORE looking at any candidate -- a round, pre-specified choice (10 evenly spaced
# points across each field's own observed-window fraction), not tuned to any result below.
N_SHAPE_POINTS = 10
ORDERING_TOLERANCE = 0.05  # peak-timing-fraction difference below this counts as "concurrent"


def peak_stats(obs: list) -> dict:
    if not obs:
        return {"first_day": None, "last_day": None, "season_length": None, "peak_day": None, "peak_value": None, "peak_day_fraction": None}
    days = [o.days_since_start for o in obs]
    values = [o.value for o in obs]
    season_length = max(days)
    peak_idx = int(np.argmax(values))
    return {
        "first_day": 0, "last_day": season_length, "season_length": season_length,
        "peak_day": days[peak_idx], "peak_value": values[peak_idx],
        "peak_day_fraction": days[peak_idx] / season_length if season_length > 0 else None,
        "n_obs": len(obs),
    }


def shape_vector(obs: list, n_points: int = N_SHAPE_POINTS) -> np.ndarray | None:
    """Interpolates the field's own real observations onto n_points evenly-spaced points across
    its own observed-window fraction [0,1] (linear interpolation between real observed values --
    never extrapolated beyond the field's own real first/last observation), then z-normalizes
    (own mean/std) -- magnitude removed, pure shape retained."""
    if len(obs) < 3:
        return None
    days = np.array([o.days_since_start for o in obs], dtype=float)
    values = np.array([o.value for o in obs], dtype=float)
    season_length = days.max()
    if season_length <= 0:
        return None
    frac = days / season_length
    order = np.argsort(frac)
    frac, values = frac[order], values[order]
    grid = np.linspace(0, 1, n_points)
    interpolated = np.interp(grid, frac, values)
    std = interpolated.std()
    if std == 0:
        return None
    return (interpolated - interpolated.mean()) / std


def field_phenology(field_result: dict) -> dict:
    out = {}
    obs_by_index = {}
    for idx in INDEX_NAMES:
        obs = build_observations(field_result["indices"].get(idx, []))
        obs_by_index[idx] = obs
        stats = peak_stats(obs)
        for k, v in stats.items():
            out[f"{idx}_{k}"] = v

    ndvi_frac, ndyi_frac = out.get("ndvi_peak_day_fraction"), out.get("ndyi_peak_day_fraction")
    if ndvi_frac is not None and ndyi_frac is not None:
        diff = ndyi_frac - ndvi_frac
        out["ndyi_vs_ndvi_ordering"] = "concurrent" if abs(diff) < ORDERING_TOLERANCE else ("before" if diff < 0 else "after")
        out["ndyi_minus_ndvi_peak_fraction"] = diff
    else:
        out["ndyi_vs_ndvi_ordering"] = None
        out["ndyi_minus_ndvi_peak_fraction"] = None

    # Fraction of real observations before / at (within tolerance) / after the NDYI peak.
    ndyi_obs = obs_by_index["ndyi"]
    if ndyi_obs and out.get("ndyi_peak_day_fraction") is not None:
        season_length = out["ndyi_season_length"]
        fracs = np.array([o.days_since_start / season_length for o in ndyi_obs]) if season_length > 0 else np.array([])
        peak_f = out["ndyi_peak_day_fraction"]
        out["frac_obs_before_ndyi_peak"] = float((fracs < peak_f - ORDERING_TOLERANCE).mean()) if len(fracs) else None
        out["frac_obs_around_ndyi_peak"] = float((np.abs(fracs - peak_f) <= ORDERING_TOLERANCE).mean()) if len(fracs) else None
        out["frac_obs_after_ndyi_peak"] = float((fracs > peak_f + ORDERING_TOLERANCE).mean()) if len(fracs) else None

    out["ndvi_shape_vector"] = shape_vector(obs_by_index["ndvi"])
    out["ndyi_shape_vector"] = shape_vector(obs_by_index["ndyi"])
    return out


def load_candidate(path: Path, key: str | None = None) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    data = raw if key is None else raw[key]
    indices = data["indices"] if "indices" in data else data
    return {"indices": {idx: [{"date": p["date"], "mean": p["value"]} for p in indices[idx]["trajectory"]] for idx in INDEX_NAMES}}


def main() -> None:
    pos_rows = [json.loads(l) for l in (PILOT_DIR / "eurocrops_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    neg_rows = [json.loads(l) for l in (PILOT_DIR / "amed_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

    print(f"[phenology_audit] === PART 1/2: Slovak (100 positives) phenology audit ===\n")
    slovak_phen = [field_phenology(r) | {"field_id": r["field_id"]} for r in pos_rows]
    df_slovak = pd.DataFrame(slovak_phen)

    for idx in INDEX_NAMES:
        col = f"{idx}_peak_day_fraction"
        vals = df_slovak[col].dropna()
        print(f"  {idx.upper()} peak timing fraction: median={vals.median():.3f} IQR=[{vals.quantile(.25):.3f},{vals.quantile(.75):.3f}] std={vals.std():.3f} n={len(vals)}")

    print(f"\n  NDYI-vs-NDVI peak ordering (n={df_slovak['ndyi_vs_ndvi_ordering'].notna().sum()}):")
    print("   ", df_slovak["ndyi_vs_ndvi_ordering"].value_counts().to_dict())
    print(f"  ndyi_minus_ndvi_peak_fraction: median={df_slovak['ndyi_minus_ndvi_peak_fraction'].median():.3f} IQR=[{df_slovak['ndyi_minus_ndvi_peak_fraction'].quantile(.25):.3f},{df_slovak['ndyi_minus_ndvi_peak_fraction'].quantile(.75):.3f}]")

    print(f"\n  Fraction of real observations before/around/after the NDYI peak (median across 100 fields):")
    for col in ["frac_obs_before_ndyi_peak", "frac_obs_around_ndyi_peak", "frac_obs_after_ndyi_peak"]:
        print(f"    {col}: median={df_slovak[col].median():.3f}")

    # --- Part 6/7: shape-similarity method ---
    print(f"\n[phenology_audit] === PART 6/7: shape-similarity (magnitude-removed, {N_SHAPE_POINTS}-point interpolated, z-normalized) ===\n")
    slovak_ndvi_shapes = np.vstack([v for v in df_slovak["ndvi_shape_vector"] if v is not None])
    slovak_ndyi_shapes = np.vstack([v for v in df_slovak["ndyi_shape_vector"] if v is not None])
    print(f"  {len(slovak_ndvi_shapes)}/100 Slovak fields have a computable NDVI shape vector (>=3 obs, nonzero variance)")

    def cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

    # Slovak-to-Slovak (leave-one-out template) similarity
    slovak_self_sims = []
    for i in range(len(slovak_ndvi_shapes)):
        template = np.delete(slovak_ndvi_shapes, i, axis=0).mean(axis=0)
        slovak_self_sims.append(cosine_sim(slovak_ndvi_shapes[i], template))
    slovak_self_sims = np.array(slovak_self_sims)
    ndvi_template = slovak_ndvi_shapes.mean(axis=0)  # full-100 template, used for all non-Slovak scoring below
    ndyi_template = slovak_ndyi_shapes.mean(axis=0)

    india_phen = [field_phenology(r) | {"field_id": r["field_id"], "crop_label": r["crop_label"]} for r in neg_rows]
    df_india = pd.DataFrame(india_phen)
    india_ndvi_shapes = [(fid, v) for fid, v in zip(df_india["field_id"], df_india["ndvi_shape_vector"]) if v is not None]
    india_sims = np.array([cosine_sim(v, ndvi_template) for _, v in india_ndvi_shapes])
    print(f"  {len(india_ndvi_shapes)}/250 India fields have a computable NDVI shape vector")

    print(f"\n  Slovak-to-Slovak (LOO template) NDVI shape similarity: mean={slovak_self_sims.mean():.3f} std={slovak_self_sims.std():.3f} median={np.median(slovak_self_sims):.3f}")
    print(f"  Slovak-to-India (unlabeled target) NDVI shape similarity: mean={india_sims.mean():.3f} std={india_sims.std():.3f} median={np.median(india_sims):.3f} p90={np.percentile(india_sims,90):.3f}")

    candidates = {
        "Karnataka-1": load_candidate(SERVER_SCRIPTS / "karnatakaCandidateFullResult.json"),
        "Gadag-dated": load_candidate(SERVER_SCRIPTS / "datedCandidateFullResult.json"),
    }
    extra = json.loads((SERVER_SCRIPTS / "additionalCandidatesFullResults.json").read_text(encoding="utf-8"))
    for name in extra:
        candidates[name] = load_candidate(SERVER_SCRIPTS / "additionalCandidatesFullResults.json", key=name)

    print(f"\n  Real Indian candidate NDVI/NDYI shape similarity to the Slovak template:")
    candidate_results = {}
    for name, c in candidates.items():
        phen = field_phenology(c)
        ndvi_sim = cosine_sim(phen["ndvi_shape_vector"], ndvi_template) if phen["ndvi_shape_vector"] is not None else None
        ndyi_sim = cosine_sim(phen["ndyi_shape_vector"], ndyi_template) if phen["ndyi_shape_vector"] is not None else None
        india_percentile = float((india_sims < ndvi_sim).mean() * 100) if ndvi_sim is not None else None
        print(f"    {name:20s} ndvi_shape_sim={ndvi_sim:.3f}  ndyi_shape_sim={ndyi_sim}  (higher than {india_percentile:.0f}% of the unlabeled India population's own NDVI-shape similarity)" if ndvi_sim is not None else f"    {name:20s} insufficient real observations for a shape vector")
        candidate_results[name] = {
            "ndvi_peak_day_fraction": phen.get("ndvi_peak_day_fraction"),
            "ndyi_peak_day_fraction": phen.get("ndyi_peak_day_fraction"),
            "ndre_peak_day_fraction": phen.get("ndre_peak_day_fraction"),
            "ndwi_peak_day_fraction": phen.get("ndwi_peak_day_fraction"),
            "ndyi_vs_ndvi_ordering": phen.get("ndyi_vs_ndvi_ordering"),
            "ndvi_shape_similarity_to_slovak_template": ndvi_sim,
            "ndyi_shape_similarity_to_slovak_template": ndyi_sim,
            "percentile_vs_unlabeled_india_population": india_percentile,
        }

    out = {
        "n_shape_points": N_SHAPE_POINTS,
        "ordering_tolerance": ORDERING_TOLERANCE,
        "slovak_peak_timing": {idx: {"median": float(df_slovak[f"{idx}_peak_day_fraction"].median()), "iqr": [float(df_slovak[f"{idx}_peak_day_fraction"].quantile(.25)), float(df_slovak[f"{idx}_peak_day_fraction"].quantile(.75))], "std": float(df_slovak[f"{idx}_peak_day_fraction"].std())} for idx in INDEX_NAMES},
        "ndyi_vs_ndvi_ordering_counts": df_slovak["ndyi_vs_ndvi_ordering"].value_counts().to_dict(),
        "slovak_self_shape_similarity": {"mean": float(slovak_self_sims.mean()), "std": float(slovak_self_sims.std()), "median": float(np.median(slovak_self_sims))},
        "india_target_shape_similarity": {"mean": float(india_sims.mean()), "std": float(india_sims.std()), "median": float(np.median(india_sims)), "p90": float(np.percentile(india_sims, 90)), "p99": float(np.percentile(india_sims, 99))},
        "candidates": candidate_results,
    }
    out_path = PILOT_DIR / "phenology_transfer_audit.json"
    out_path.write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    print(f"\n[phenology_audit] wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
