"""
Real dataset-preparation ETL. Loads whatever real, provenance-tagged sources actually exist on
disk, validates every row against the FieldExample schema, and writes a single combined,
ML-ready table. Never invents a row: a source that doesn't exist yet (e.g. real Sunflower
positives, not yet obtained) is simply absent from the output, reported as 0, not backfilled.

Run: training/.venv/bin/python3 training/sunflower/prepare_dataset.py
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pandas as pd

from schema import field_example_from_dict

REPO_ROOT = Path(__file__).resolve().parents[2]

# Real sources this pipeline knows how to ingest, each with a fixed, honest label_source tag.
# A source whose file doesn't exist on disk is skipped and reported as 0 rows — never faked.
SOURCES = [
    {
        "path": REPO_ROOT / "server" / "data" / "training" / "sunflower-belt-competing-crops.jsonl",
        "label_source": "amed_confirmed_negative",
        "row_adapter": "amed_negative",
    },
    {
        # Not yet obtained (see project investigation notes) — present here only so the
        # pipeline picks it up automatically the moment it's provided, without code changes.
        "path": REPO_ROOT / "training" / "data" / "sunflower-positives-haryana-harsac.jsonl",
        "label_source": "haryana_harsac_2024",
        "row_adapter": "sunflower_positive",
    },
    {
        # REAL, obtained: 4,893 real Sunflower parcels from EuroCrops' Slovak 2021 dataset (see
        # ingest_eurocrops.py). EUROPEAN, not Indian — kept fully separate via label_source/
        # country on every row; used for pipeline development/validation only, never a stand-in
        # for Indian production ground truth.
        "path": REPO_ROOT / "training" / "data" / "sunflower-positives-eurocrops-slovakia.jsonl",
        "label_source": "eurocrops_slovakia_2021",
        "row_adapter": "sunflower_positive",
    },
]


def adapt_amed_negative_row(raw: dict) -> dict:
    """Maps a row from collectSunflowerBeltCompetingCrops.ts's real output into the
    FieldExample schema. amedCrop/amedConfidence/monitoringHistory come straight from a real,
    live AMED response — nothing here is invented."""
    return {
        "field_id": raw["fieldId"],
        "latitude": raw["coordinate"]["lat"],
        "longitude": raw["coordinate"]["lng"],
        "crop_label": raw["amedCrop"],
        "label_source": "amed_confirmed_negative",
        "country": "India",
        "state": raw["region"],
        "district": raw.get("district"),
        "season": raw["season"],
        "year": raw["year"],
        "geometry_source": "alu",
        "polygon": raw.get("geometry"),
        "label_quality": f"amed_confidence={raw.get('amedConfidence')}",
    }


def adapt_sunflower_positive_row(raw: dict) -> dict:
    """Expects the exact CSV/JSON schema requested from the founder/authors (section 7 of the
    project's data-acquisition plan): field_id, latitude, longitude, crop, sowing_date,
    flowering_date, harvest_date, district, state, season, year, plus a bloom_date_source tag
    this adapter requires explicitly (never inferred). `label_source` and `country` are read
    from the row itself — NEVER hardcoded here — so a source like EuroCrops (real, but
    European) can never be silently mislabeled as an Indian source just by sharing this
    adapter. Every positive-source ingestion script (see ingest_eurocrops.py) is responsible
    for stamping its own real, honest label_source/country on every row it writes."""
    return {
        "field_id": raw["field_id"],
        "latitude": raw["latitude"],
        "longitude": raw["longitude"],
        "crop_label": "SUNFLOWER",
        "label_source": raw["label_source"],
        "country": raw["country"],
        "state": raw["state"],
        "district": raw.get("district"),
        "season": raw["season"],
        "year": raw["year"],
        "geometry_source": raw.get("geometry_source", "point_only"),
        "polygon": raw.get("polygon"),
        "sowing_date": raw.get("sowing_date"),
        "flowering_date": raw.get("flowering_date"),
        "bloom_date_source": raw.get("bloom_date_source"),
        "harvest_date": raw.get("harvest_date"),
        "label_quality": raw.get("label_quality"),
    }


ADAPTERS = {"amed_negative": adapt_amed_negative_row, "sunflower_positive": adapt_sunflower_positive_row}


def load_source(source: dict) -> list[dict]:
    path: Path = source["path"]
    if not path.exists():
        print(f"[prepare] SKIP (not present): {path.relative_to(REPO_ROOT)}")
        return []

    adapter = ADAPTERS[source["row_adapter"]]
    examples = []
    skipped = 0
    with path.open("r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            raw = json.loads(line)
            try:
                example = field_example_from_dict(adapter(raw))
            except (ValueError, KeyError) as error:
                skipped += 1
                if skipped <= 5:
                    print(f"[prepare]   skipping malformed row at {path.name}:{line_num}: {error}")
                continue
            examples.append(example.__dict__)

    print(f"[prepare] loaded {len(examples)} valid rows from {path.relative_to(REPO_ROOT)} (skipped {skipped} malformed)")
    return examples


def main() -> None:
    all_rows: list[dict] = []
    for source in SOURCES:
        all_rows.extend(load_source(source))

    if not all_rows:
        print("\n[prepare] No real data available from any source. Nothing written.")
        return

    df = pd.DataFrame(all_rows)

    out_dir = REPO_ROOT / "training" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "combined_field_examples.jsonl"
    # JSONL (not parquet) deliberately — avoids an extra heavy dependency for a dataset this
    # size, and handles the nested `polygon` GeoJSON value naturally.
    with out_path.open("w", encoding="utf-8") as f:
        for row in df.to_dict(orient="records"):
            f.write(json.dumps(row, default=str) + "\n")

    print(f"\n[prepare] wrote {len(df)} total rows to {out_path.relative_to(REPO_ROOT)}")
    print("\n[prepare] rows by label_source:")
    for source, count in Counter(df["label_source"]).most_common():
        print(f"  {source}: {count}")
    print("\n[prepare] rows by crop_label:")
    for crop, count in Counter(df["crop_label"]).most_common():
        print(f"  {crop}: {count}")
    print("\n[prepare] rows by state:")
    for state, count in Counter(df["state"]).most_common():
        print(f"  {state}: {count}")

    sunflower_count = int((df["crop_label"] == "SUNFLOWER").sum())
    print(f"\n[prepare] REAL Sunflower-positive rows available: {sunflower_count}")
    if sunflower_count == 0:
        print("[prepare] No Sunflower positives yet — training cannot proceed. See training/sunflower/train.py's guard.")


if __name__ == "__main__":
    main()
