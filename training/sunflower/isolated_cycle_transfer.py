"""
Isolates each field's own real single growing cycle (defined ONLY from that field's own real
NDVI observation sequence -- never a crop label, never Google Earth knowledge, never candidate-
specific tuning) and retests whether a transferable sunflower signal survives multi-cycle-window
contamination. Zero new CDSE requests -- reuses already-extracted local raw daily series and
already-tested helpers (build_observations, compute_phenology_features,
normalize_by_season_fraction, combo_score, leave_one_field_out_source_scores, diagnose) rather
than duplicating any of them.

=== FROZEN CYCLE-ISOLATION ALGORITHM (defined before any candidate result was examined) ===

Given a field's real NDVI (day, value) series (missing/None values already dropped by
build_observations, never fabricated):

1. Require >= MIN_OBS_TOTAL=8 real NDVI observations, else INSUFFICIENT.
2. field_range = max(value) - min(value). Require field_range >= ABS_RANGE_FLOOR=0.05 (else the
   series is too flat to contain any real cycle structure), else INSUFFICIENT.
3. Find local maxima/minima in the REAL observed sequence only (value[i] vs its real immediate
   neighbors -- no interpolation, no smoothing that would invent a value between real points).
4. threshold = max(PROMINENCE_ABS_FLOOR=0.10, PROMINENCE_FRAC=0.25 * field_range). A local
   minimum is a "significant trough" (a real cycle boundary) only if it drops by >= threshold
   from BOTH its nearest preceding and following real local maxima (an edge minimum with only
   one neighboring side is judged on that side alone).
5. Significant troughs partition the real timeline into candidate cycle segments.
6. Select the ONE segment containing the field's own global real observed maximum NDVI value --
   this rule is purely intrinsic to the field's own data (the single most-vegetative real moment
   in its whole series); it never references a Slovak template, a crop label, or any candidate-
   specific knowledge.
7. The isolated cycle = every real observation (across ALL 4 indices, not just NDVI) whose real
   date falls within the selected segment's [start_day, end_day] (segment boundaries are the
   bounding significant troughs' real days, or the series' own first/last real day if no
   bounding trough exists on that side).
8. Require >= MIN_OBS_CYCLE=5 real observations within the isolated segment, else INSUFFICIENT.
9. Re-base days_since_start to the isolated cycle's OWN first real observation (day 0 = the
   cycle's own start, not the original field's full-window start).

Applied IDENTICALLY to the 100 Slovak positives, the 250 India AMED fields (unlabeled target
population), and every real Indian candidate.

Run: training/.venv/bin/python3 training/sunflower/isolated_cycle_transfer.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from pilot_features import build_observations
from pilot_ensemble_score import combo_score, leave_one_field_out_source_scores
from pilot_leakage_diagnosis import diagnose
from temporal_features import Observation, compute_phenology_features

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
SERVER_SCRIPTS = REPO_ROOT / "server" / "scripts"
INDEX_NAMES = ["ndvi", "ndre", "ndwi", "ndyi"]

MIN_OBS_TOTAL = 8
ABS_RANGE_FLOOR = 0.05
PROMINENCE_ABS_FLOOR = 0.10
PROMINENCE_FRAC = 0.25
MIN_OBS_CYCLE = 5
N_SHAPE_POINTS = 10  # frozen, matches phenology_transfer_audit.py's prior choice


def isolate_cycle(ndvi_series: list[dict]) -> tuple[int, int] | None:
    """Returns (start_day, end_day) of the isolated cycle in the field's own NDVI days-since-
    first-observation units, or None if INSUFFICIENT. Pure function of this field's own real
    NDVI series only."""
    obs = build_observations(ndvi_series)
    if len(obs) < MIN_OBS_TOTAL:
        return None
    days = [o.days_since_start for o in obs]
    values = [o.value for o in obs]
    field_range = max(values) - min(values)
    if field_range < ABS_RANGE_FLOOR:
        return None
    threshold = max(PROMINENCE_ABS_FLOOR, PROMINENCE_FRAC * field_range)

    n = len(values)
    is_local_max = [False] * n
    is_local_min = [False] * n
    for i in range(n):
        left_ok = i == 0 or values[i] >= values[i - 1]
        right_ok = i == n - 1 or values[i] >= values[i + 1]
        if left_ok and right_ok and (i == 0 or values[i] > values[i - 1] or i == n - 1 or values[i] > values[i + 1]):
            is_local_max[i] = True
        left_ok_min = i == 0 or values[i] <= values[i - 1]
        right_ok_min = i == n - 1 or values[i] <= values[i + 1]
        if left_ok_min and right_ok_min and (i == 0 or values[i] < values[i - 1] or i == n - 1 or values[i] < values[i + 1]):
            is_local_min[i] = True

    max_indices = [i for i in range(n) if is_local_max[i]]

    def nearest_max_before(i: int) -> int | None:
        candidates = [j for j in max_indices if j <= i]
        return max(candidates) if candidates else None

    def nearest_max_after(i: int) -> int | None:
        candidates = [j for j in max_indices if j >= i]
        return min(candidates) if candidates else None

    significant_trough_indices = []
    for i in range(n):
        if not is_local_min[i]:
            continue
        before = nearest_max_before(i)
        after = nearest_max_after(i)
        drops = []
        if before is not None and before != i:
            drops.append(values[before] - values[i])
        if after is not None and after != i:
            drops.append(values[after] - values[i])
        if not drops:
            continue
        if all(d >= threshold for d in drops):
            significant_trough_indices.append(i)

    boundaries = [0] + significant_trough_indices + [n - 1]
    boundaries = sorted(set(boundaries))
    segments = [(boundaries[k], boundaries[k + 1]) for k in range(len(boundaries) - 1)]
    if not segments:
        segments = [(0, n - 1)]

    global_peak_idx = int(np.argmax(values))
    selected = None
    for seg_start, seg_end in segments:
        if seg_start <= global_peak_idx <= seg_end:
            selected = (seg_start, seg_end)
            break
    if selected is None:
        selected = (0, n - 1)

    start_day, end_day = days[selected[0]], days[selected[1]]
    n_in_cycle = sum(1 for d in days if start_day <= d <= end_day)
    if n_in_cycle < MIN_OBS_CYCLE:
        return None
    return start_day, end_day


def rebased_observations(daily_series: list[dict], start_day: int, end_day: int) -> list[Observation]:
    obs = build_observations(daily_series)
    in_cycle = [o for o in obs if start_day <= o.days_since_start <= end_day]
    if not in_cycle:
        return []
    cycle_start = min(o.days_since_start for o in in_cycle)
    return [Observation(days_since_start=o.days_since_start - cycle_start, value=o.value) for o in in_cycle]


def shape_vector(obs: list[Observation], n_points: int = N_SHAPE_POINTS) -> np.ndarray | None:
    if len(obs) < 3:
        return None
    days = np.array([o.days_since_start for o in obs], dtype=float)
    values = np.array([o.value for o in obs], dtype=float)
    span = days.max()
    if span <= 0:
        return None
    frac = days / span
    order = np.argsort(frac)
    frac, values = frac[order], values[order]
    grid = np.linspace(0, 1, n_points)
    interpolated = np.interp(grid, frac, values)
    std = interpolated.std()
    if std == 0:
        return None
    return (interpolated - interpolated.mean()) / std


def field_isolated_features(field_result: dict) -> dict | None:
    """Returns None if the field is INSUFFICIENT (no reliable single cycle could be isolated).
    Otherwise all Part-9 representations computed from the SAME isolated cycle window."""
    cycle = isolate_cycle(field_result["indices"].get("ndvi", []))
    if cycle is None:
        return None
    start_day, end_day = cycle

    feats: dict = {"cycle_start_day": start_day, "cycle_end_day": end_day, "cycle_length_days": end_day - start_day}
    obs_by_index = {}
    for idx in INDEX_NAMES:
        obs = rebased_observations(field_result["indices"].get(idx, []), start_day, end_day)
        obs_by_index[idx] = obs
        values = [o.value for o in obs]
        # D: production-style aggregate, restricted to the isolated cycle
        feats[f"{idx}_mean"] = float(np.mean(values)) if values else None
        feats[f"{idx}_peak_value"] = float(np.max(values)) if values else None
        # E: existing temporal-shape representation, reused verbatim, on the isolated cycle
        if len(obs) >= 2:
            pf = compute_phenology_features(obs, as_of_day=max(o.days_since_start for o in obs))
            feats[f"{idx}_slope"] = pf.slope
            feats[f"{idx}_pre_peak_slope"] = pf.pre_peak_slope
            feats[f"{idx}_post_peak_slope"] = pf.post_peak_slope
            feats[f"{idx}_growth_acceleration"] = pf.growth_acceleration
            feats[f"{idx}_variability"] = pf.variability
        else:
            for suffix in ["slope", "pre_peak_slope", "post_peak_slope", "growth_acceleration", "variability"]:
                feats[f"{idx}_{suffix}"] = None

    ndre_p, ndvi_p = feats.get("ndre_peak_value"), feats.get("ndvi_peak_value")
    feats["ndre_ndvi_peak_ratio"] = ndre_p / ndvi_p if (ndre_p is not None and ndvi_p not in (None, 0)) else None

    feats["ndvi_shape_vector"] = shape_vector(obs_by_index["ndvi"])
    feats["ndyi_shape_vector"] = shape_vector(obs_by_index["ndyi"])
    return feats


def load_candidate(path: Path, key: str | None = None) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    data = raw if key is None else raw[key]
    indices = data["indices"] if "indices" in data else data
    return {"indices": {idx: [{"date": p["date"], "mean": p["value"]} for p in indices[idx]["trajectory"]] for idx in INDEX_NAMES}}


PRODUCTION_COLS = [f"{idx}_{stat}" for idx in INDEX_NAMES for stat in ["mean", "peak_value"]] + ["ndre_ndvi_peak_ratio"]
SHAPE_TEMPORAL_COLS = [f"{idx}_{stat}" for idx in INDEX_NAMES for stat in ["slope", "pre_peak_slope", "post_peak_slope", "growth_acceleration", "variability"]]


def cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def main() -> None:
    pos_rows = [json.loads(l) for l in (PILOT_DIR / "eurocrops_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    neg_rows = [json.loads(l) for l in (PILOT_DIR / "amed_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

    slovak_records, slovak_insufficient = [], 0
    for r in pos_rows:
        feats = field_isolated_features(r)
        if feats is None:
            slovak_insufficient += 1
            continue
        feats["field_id"] = r["field_id"]
        slovak_records.append(feats)
    df_slovak = pd.DataFrame(slovak_records)
    print(f"[isolated_cycle] Slovak: {len(df_slovak)}/{len(pos_rows)} successfully segmented, {slovak_insufficient} insufficient")

    india_records, india_insufficient = [], 0
    for r in neg_rows:
        feats = field_isolated_features(r)
        if feats is None:
            india_insufficient += 1
            continue
        feats["field_id"] = r["field_id"]
        feats["crop_label"] = r["crop_label"]
        india_records.append(feats)
    df_india = pd.DataFrame(india_records)
    print(f"[isolated_cycle] India (unlabeled target): {len(df_india)}/{len(neg_rows)} successfully segmented, {india_insufficient} insufficient")

    print(f"\nSlovak isolated-cycle length (days): median={df_slovak['cycle_length_days'].median():.0f} IQR=[{df_slovak['cycle_length_days'].quantile(.25):.0f},{df_slovak['cycle_length_days'].quantile(.75):.0f}]")
    print(f"India isolated-cycle length (days): median={df_india['cycle_length_days'].median():.0f} IQR=[{df_india['cycle_length_days'].quantile(.25):.0f},{df_india['cycle_length_days'].quantile(.75):.0f}]")

    candidates_raw = {
        "Karnataka-1": load_candidate(SERVER_SCRIPTS / "karnatakaCandidateFullResult.json"),
        "Gadag-dated": load_candidate(SERVER_SCRIPTS / "datedCandidateFullResult.json"),
    }
    extra = json.loads((SERVER_SCRIPTS / "additionalCandidatesFullResults.json").read_text(encoding="utf-8"))
    for name in extra:
        candidates_raw[name] = load_candidate(SERVER_SCRIPTS / "additionalCandidatesFullResults.json", key=name)

    candidate_records = {}
    print("\nCandidate cycle isolation:")
    for name, c in candidates_raw.items():
        feats = field_isolated_features(c)
        if feats is None:
            print(f"  {name}: INSUFFICIENT (no reliable single cycle could be isolated)")
            candidate_records[name] = None
        else:
            print(f"  {name}: cycle_length={feats['cycle_length_days']}d")
            candidate_records[name] = feats

    df_candidates = pd.DataFrame([v | {"field_id": k} for k, v in candidate_records.items() if v is not None])

    results: dict = {
        "n_fields": {"slovak_total": len(pos_rows), "slovak_segmented": len(df_slovak), "slovak_insufficient": slovak_insufficient,
                     "india_total": len(neg_rows), "india_segmented": len(df_india), "india_insufficient": india_insufficient},
        "cycle_length_days": {"slovak_median": float(df_slovak["cycle_length_days"].median()), "india_median": float(df_india["cycle_length_days"].median())},
        "representations": {},
    }

    representations = {
        "A_ndvi_shape": ("shape", "ndvi_shape_vector"),
        "B_ndyi_shape": ("shape", "ndyi_shape_vector"),
        "D_production_isolated": ("vector", PRODUCTION_COLS),
        "E_temporal_shape_isolated": ("vector", SHAPE_TEMPORAL_COLS),
    }

    for rep_name, (kind, spec) in representations.items():
        print(f"\n{'='*70}\nREPRESENTATION {rep_name}\n{'='*70}")
        if kind == "shape":
            col = spec
            slovak_vecs = np.vstack([v for v in df_slovak[col] if v is not None])
            slovak_ids_with_vec = [fid for fid, v in zip(df_slovak["field_id"], df_slovak[col]) if v is not None]
            print(f"  {len(slovak_vecs)}/{len(df_slovak)} Slovak fields have a computable shape vector")

            self_sims = []
            for i in range(len(slovak_vecs)):
                template = np.delete(slovak_vecs, i, axis=0).mean(axis=0)
                self_sims.append(cosine_sim(slovak_vecs[i], template))
            self_sims = np.array(self_sims)
            template_full = slovak_vecs.mean(axis=0)

            india_vecs = [(fid, v) for fid, v in zip(df_india["field_id"], df_india[col]) if v is not None]
            india_sims = np.array([cosine_sim(v, template_full) for _, v in india_vecs])
            print(f"  Slovak self-similarity (LOO): mean={self_sims.mean():.3f} median={np.median(self_sims):.3f} std={self_sims.std():.3f}")
            print(f"  India background similarity: mean={india_sims.mean():.3f} median={np.median(india_sims):.3f} p90={np.percentile(india_sims,90):.3f} p99={np.percentile(india_sims,99):.3f}")

            cand_results = {}
            for name in candidates_raw:
                row = candidate_records.get(name)
                if row is None or row.get(col) is None:
                    cand_results[name] = None
                    print(f"    {name}: no computable shape vector (insufficient cycle)")
                    continue
                sim = cosine_sim(row[col], template_full)
                pct = float((india_sims < sim).mean() * 100)
                cand_results[name] = {"similarity": sim, "percentile_vs_india_background": pct}
                print(f"    {name}: similarity={sim:.3f}  (percentile vs India background: {pct:.0f}%)")

            results["representations"][rep_name] = {
                "slovak_self_similarity": {"mean": float(self_sims.mean()), "median": float(np.median(self_sims)), "std": float(self_sims.std())},
                "india_background_similarity": {"mean": float(india_sims.mean()), "median": float(np.median(india_sims)), "p90": float(np.percentile(india_sims, 90)), "p99": float(np.percentile(india_sims, 99))},
                "candidates": cand_results,
            }
        else:
            cols = [c for c in spec if c in df_slovak.columns]
            lofo = leave_one_field_out_source_scores(df_slovak, cols)
            print(f"  Slovak LOFO score: mean={lofo.mean():.3f} median={np.median(lofo):.3f} std={lofo.std():.3f}")

            combined = pd.concat([df_slovak.assign(source="slovak"), df_india.assign(source="india")], ignore_index=True)
            sep = diagnose(combined, cols, rep_name)

            india_scores = combo_score(df_slovak, df_india, cols)
            print(f"  India background score: mean={india_scores.mean():.4f} p90={np.percentile(india_scores,90):.4f} p99={np.percentile(india_scores,99):.4f} max={india_scores.max():.4f}")
            print(f"  Source separability: accuracy={sep['accuracy']:.4f} ROC-AUC={sep['roc_auc']:.4f}")

            cand_results = {}
            if len(df_candidates) > 0:
                cand_scores = combo_score(df_slovak, df_candidates, cols)
                for fid, s in zip(df_candidates["field_id"], cand_scores):
                    pct = float((india_scores < s).mean() * 100)
                    cand_results[fid] = {"score": float(s), "percentile_vs_india_background": pct}
                    print(f"    {fid}: score={s*100:.2f}%  (percentile vs India background: {pct:.0f}%)")
            for name in candidates_raw:
                if name not in cand_results:
                    cand_results[name] = None
                    print(f"    {name}: no isolated cycle (insufficient)")

            results["representations"][rep_name] = {
                "features": cols,
                "lofo_stats": {"mean": float(lofo.mean()), "median": float(np.median(lofo)), "std": float(lofo.std())},
                "source_separability": {"accuracy": sep["accuracy"], "roc_auc": sep["roc_auc"]},
                "india_background_score": {"mean": float(india_scores.mean()), "p90": float(np.percentile(india_scores, 90)), "p99": float(np.percentile(india_scores, 99)), "max": float(india_scores.max())},
                "candidates": cand_results,
            }

    out_path = PILOT_DIR / "isolated_cycle_transfer_results.json"
    out_path.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    print(f"\n[isolated_cycle] wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
