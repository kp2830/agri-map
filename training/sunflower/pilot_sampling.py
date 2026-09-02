"""
Reproducible stratified sampling for the 100-positive / 250-negative scientific pilot.

Algorithm (documented per the task requirement, not just implemented):
1. Sort the real candidate pool by its real stratification key (area for EuroCrops; region/
   state for AMED — the two real, available diversity signals in each real dataset).
2. Split into strata (deciles for area; actual real state groups for AMED, proportional to
   each state's real share of the 39,218-field pool).
3. Within each stratum, draw a uniform random sample WITHOUT replacement using a single,
   fixed, recorded seed (Python's `random.Random(seed)`, not the global RNG) — so re-running
   this script with the same seed against the same source files always reproduces the exact
   same field_id list.

This extends (not duplicates) `extract_features.py`'s existing `select_stratified_sample` —
that one strides deterministically through a single area-sorted list with no randomness inside
strata and no support for a second stratification key (region); this pilot needs both a real
random seed and, for the Indian side, geographic (not area) stratification.

Run: training/.venv/bin/python3 training/sunflower/pilot_sampling.py
"""

from __future__ import annotations

import hashlib
import json
import random
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
EUROCROPS_PATH = REPO_ROOT / "training" / "data" / "sunflower-positives-eurocrops-slovakia.jsonl"
AMED_PATH = REPO_ROOT / "server" / "data" / "training" / "sunflower-belt-competing-crops.jsonl"
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"

SAMPLING_SEED = 42  # fixed, recorded — the same constant already used for train.py's GroupShuffleSplit
N_POSITIVES = 100
N_NEGATIVES = 250
N_AREA_STRATA = 10  # deciles


def geometry_hash(geometry: dict) -> str:
    """A stable identifier for a field's real geometry — lets a later run verify it extracted
    features for the exact same polygon, without needing to store the full geometry in every
    downstream file."""
    return hashlib.sha256(json.dumps(geometry, sort_keys=True).encode("utf-8")).hexdigest()[:16]


def field_area_ha(row: dict) -> float | None:
    match = re.search(r"area_ha=([\d.]+)", row.get("label_quality", ""))
    return float(match.group(1)) if match else None


def stratified_sample_by_area(rows: list[dict], n: int, seed: int) -> list[dict]:
    with_area = [(r, field_area_ha(r)) for r in rows]
    with_area = [(r, a) for r, a in with_area if a is not None]
    with_area.sort(key=lambda x: x[1])

    strata: list[list[dict]] = [[] for _ in range(N_AREA_STRATA)]
    stratum_size = len(with_area) / N_AREA_STRATA
    for i, (row, _area) in enumerate(with_area):
        stratum_idx = min(int(i / stratum_size), N_AREA_STRATA - 1)
        strata[stratum_idx].append(row)

    per_stratum = n // N_AREA_STRATA
    remainder = n - per_stratum * N_AREA_STRATA
    rng = random.Random(seed)
    selected: list[dict] = []
    for i, stratum in enumerate(strata):
        take = per_stratum + (1 if i < remainder else 0)
        take = min(take, len(stratum))
        selected.extend(rng.sample(stratum, take))
    return selected


def stratified_sample_by_region(rows: list[dict], n: int, seed: int) -> list[dict]:
    by_region: dict[str, list[dict]] = {}
    for row in rows:
        by_region.setdefault(row["region"], []).append(row)

    total = len(rows)
    rng = random.Random(seed)
    selected: list[dict] = []
    for region, region_rows in by_region.items():
        # Proportional to each real state's real share of the full 39,218-field pool.
        take = round(n * len(region_rows) / total)
        take = min(take, len(region_rows))
        selected.extend(rng.sample(region_rows, take))

    # Rounding can land a field or two short/over N — trim/top-up deterministically from the
    # full shuffled pool (same seed) rather than biasing toward whichever region iterated last.
    if len(selected) > n:
        rng.shuffle(selected)
        selected = selected[:n]
    elif len(selected) < n:
        remaining = [r for r in rows if r not in selected]
        rng.shuffle(remaining)
        selected.extend(remaining[: n - len(selected)])
    return selected


def main() -> None:
    PILOT_DIR.mkdir(parents=True, exist_ok=True)

    eurocrops_rows = [json.loads(l) for l in EUROCROPS_PATH.read_text(encoding="utf-8").splitlines() if l.strip()]
    positives = stratified_sample_by_area(eurocrops_rows, N_POSITIVES, SAMPLING_SEED)

    amed_rows = [json.loads(l) for l in AMED_PATH.read_text(encoding="utf-8").splitlines() if l.strip()]
    negatives = stratified_sample_by_region(amed_rows, N_NEGATIVES, SAMPLING_SEED)

    pos_manifest = []
    for row in positives:
        pos_manifest.append(
            {
                "field_id": row["field_id"],
                "source": row["label_source"],
                "country": row["country"],
                "crop_label": row["crop_label"],
                "area_ha": field_area_ha(row),
                "geometry_hash": geometry_hash(row["polygon"]),
                "sampling_seed": SAMPLING_SEED,
                "polygon": row["polygon"],  # kept here for the extraction step; provenance-only, not a model feature
            }
        )

    neg_manifest = []
    for row in negatives:
        neg_manifest.append(
            {
                "field_id": row["fieldId"],
                "source": row["labelSource"],
                "country": "India",
                "region": row["region"],
                "district": row["district"],
                "crop_label": row["amedCrop"],
                "amed_confidence": row["amedConfidence"],
                "season": row["season"],
                "year": row["year"],
                "geometry_hash": geometry_hash(row["geometry"]),
                "sampling_seed": SAMPLING_SEED,
                "polygon": row["geometry"],
            }
        )

    pos_path = PILOT_DIR / "eurocrops_100_manifest.jsonl"
    neg_path = PILOT_DIR / "amed_negative_manifest.jsonl"
    pos_path.write_text("\n".join(json.dumps(r) for r in pos_manifest) + "\n", encoding="utf-8")
    neg_path.write_text("\n".join(json.dumps(r) for r in neg_manifest) + "\n", encoding="utf-8")

    print(f"[pilot_sampling] seed={SAMPLING_SEED}")
    print(f"[pilot_sampling] positives: {len(pos_manifest)} written to {pos_path.relative_to(REPO_ROOT)}")
    area_vals = sorted(r["area_ha"] for r in pos_manifest)
    print(f"[pilot_sampling]   area range: {area_vals[0]:.2f}ha - {area_vals[-1]:.2f}ha, median {area_vals[len(area_vals)//2]:.2f}ha")
    print(f"[pilot_sampling] negatives: {len(neg_manifest)} written to {neg_path.relative_to(REPO_ROOT)}")
    from collections import Counter

    print(f"[pilot_sampling]   region distribution: {dict(Counter(r['region'] for r in neg_manifest))}")
    print(f"[pilot_sampling]   crop distribution: {dict(Counter(r['crop_label'] for r in neg_manifest))}")


if __name__ == "__main__":
    main()
