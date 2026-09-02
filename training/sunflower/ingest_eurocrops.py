"""
Real ingestion of EuroCrops' Slovak 2021 parcel dataset, filtered to Sunflower. This is REAL,
downloaded, verified data — 255,710 real Slovak agricultural parcels, of which 4,893 are
labeled "Annual sunflower" (or a close sunflower variant) in EuroCrops' harmonized crop
taxonomy (HCAT). Source: Zenodo record 6868143, SK_2021.zip, CC-BY-4.0 (commercial use
permitted with attribution).

CRITICAL: this is EUROPEAN data. Every row is tagged country="Slovakia", label_source=
"eurocrops_slovakia_2021" — never "India", never silently merged with the AMED-derived Indian
negatives without that distinction being visible. This dataset exists in this pipeline for
development/pipeline-validation purposes (proving real Sunflower geometry + labels can flow
through the same schema and feature-extraction path a real Indian dataset eventually will) —
it must never be used to claim Indian production accuracy. See schema.py's LabelSource type
and this project's own data-acquisition investigation notes for why.

Requires the raw shapefile downloaded and unzipped locally (not committed — see
EUROCROPS_SHAPEFILE_PATH below; point it at wherever you extracted SK_2021.zip).

FIELD-ID COLLISION (investigated and fixed): the original field_id scheme
(f"eurocrops_sk_{KODKD}_{PCUV}") collided for 538 of 4,893 real sunflower rows. Investigated by
inspecting the raw shapefile records directly: this is NOT a bug in this script's string
formatting, and it is NOT resolved by adding the third obvious candidate field (PARCELA) either
— confirmed real example: KODKD="519128402/1", PARCELA="A", PCUV=1 is shared by FOUR real, distinct
shapefile records with four different real areas (VYMERA 0.99/6.32/7.1/10.04 ha) and four
different real polygons. EuroCrops' Slovak HCAT export has no attribute field that is a
per-geometry unique key — KODKD/PARCELA/PCUV together identify a declared land-parcel/block
*group*, and a single group can genuinely correspond to multiple separately-digitized real
sub-parcels in this export. The only attribute that reliably disambiguates them is the geometry
itself. Fix: every row's field_id now embeds a geometry_hash of its own real polygon
(`eurocrops_sk_{KODKD}_{PCUV}__{geometry_hash}`), guaranteeing distinct real geometries can never
collide, while the original administrative code is preserved verbatim in a separate
`source_field_id` column for traceability back to the raw shapefile attributes. Two records with
IDENTICAL geometry (a true duplicate row, not just a shared admin code) will still collide by
design — see the QC output below, which reports that count separately.

Run: training/.venv/bin/python3 training/sunflower/ingest_eurocrops.py
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

import shapefile
from pyproj import Transformer

REPO_ROOT = Path(__file__).resolve().parents[2]
# Point this at your local extraction of Zenodo record 6868143's SK_2021.zip — not committed,
# not shipped with this repo (833MB uncompressed; each user/environment downloads it fresh from
# the real public source, exactly as this ingestion script itself did).
EUROCROPS_SHAPEFILE_PATH = Path(
    "/private/tmp/claude-501/-Users-kavyapatni-Desktop-agri-map/647285be-9ccc-4ebc-a285-0d85df004c5c/scratchpad/eurocrops/SK/SK_2021_EC21.shp"
)
OUTPUT_PATH = REPO_ROOT / "training" / "data" / "sunflower-positives-eurocrops-slovakia.jsonl"

# EuroCrops' Slovak parcels are in S-JTSK / Krovak East-North (EPSG:5514) — reproject every
# real vertex to WGS84 so this data uses the same lat/lng convention as everything else in this
# pipeline (and in the live application).
_transformer = Transformer.from_crs("EPSG:5514", "EPSG:4326", always_xy=True)


def shape_to_geojson_polygon(shape) -> dict:
    """Converts a real pyshp polygon shape (parts + points in EPSG:5514) into a real GeoJSON
    Polygon in WGS84 — reprojecting every actual vertex, never approximating or simplifying the
    boundary."""
    parts = list(shape.parts) + [len(shape.points)]
    rings = []
    for i in range(len(parts) - 1):
        ring_points = shape.points[parts[i] : parts[i + 1]]
        reprojected = [_transformer.transform(x, y) for x, y in ring_points]
        rings.append([[round(lon, 7), round(lat, 7)] for lon, lat in reprojected])
    return {"type": "Polygon", "coordinates": rings}


def centroid_of_ring(ring: list[list[float]]) -> tuple[float, float]:
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return sum(lats) / len(lats), sum(lons) / len(lons)


def geometry_hash(geometry: dict) -> str:
    """Stable identifier for a real polygon's actual vertex set (same convention used
    elsewhere in this pipeline, e.g. pilot_sampling.py) — the only attribute in this shapefile
    that reliably disambiguates distinct real parcels sharing identical KODKD/PARCELA/PCUV
    administrative codes (see the field_id collision investigation in ingest_eurocrops.py's
    module docstring / the pilot report)."""
    return hashlib.sha256(json.dumps(geometry, sort_keys=True).encode("utf-8")).hexdigest()[:16]


def main() -> None:
    if not EUROCROPS_SHAPEFILE_PATH.exists():
        print(f"[ingest_eurocrops] {EUROCROPS_SHAPEFILE_PATH} not found — download and unzip Zenodo record 6868143's SK_2021.zip first.")
        return

    sf = shapefile.Reader(str(EUROCROPS_SHAPEFILE_PATH))
    rows = []
    skipped_no_geometry = 0

    for shape_rec in sf.iterShapeRecords():
        crop_name = (shape_rec.record["sk_2021_tr"] or "").strip()
        if "sunflower" not in crop_name.lower():
            continue

        shape = shape_rec.shape
        if not shape.points:
            skipped_no_geometry += 1
            continue

        polygon = shape_to_geojson_polygon(shape)
        lat, lon = centroid_of_ring(polygon["coordinates"][0])
        geom_hash = geometry_hash(polygon)
        source_field_id = f"eurocrops_sk_{shape_rec.record['KODKD']}_{shape_rec.record['PCUV']}"

        rows.append(
            {
                "field_id": f"{source_field_id}__{geom_hash}",
                "source_field_id": source_field_id,
                "geometry_hash": geom_hash,
                "latitude": lat,
                "longitude": lon,
                "crop_label": "SUNFLOWER",
                "label_source": "eurocrops_slovakia_2021",
                "country": "Slovakia",
                "state": "Slovakia",  # no sub-national breakdown in this HCAT export
                "district": None,
                "season": "unknown",  # EuroCrops gives calendar year, not Kharif/Rabi-style season
                "year": 2021,
                "geometry_source": "third_party_polygon",
                "polygon": polygon,
                "label_quality": f"eurocrops_hcat_crop_name={crop_name}; area_ha={shape_rec.record['VYMERA']}",
            }
        )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")

    print(f"[ingest_eurocrops] real Sunflower parcels found: {len(rows)} (skipped {skipped_no_geometry} with no geometry)")
    print(f"[ingest_eurocrops] wrote {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    if rows:
        print(f"[ingest_eurocrops] example: {json.dumps({k: v for k, v in rows[0].items() if k != 'polygon'})}")
        print(f"[ingest_eurocrops]   (polygon has {len(rows[0]['polygon']['coordinates'][0])} real vertices)")

    # --- QC: prove the new field_id scheme cannot collide for distinct real geometries ---
    n_source_rows = len(rows)
    internal_ids = [r["field_id"] for r in rows]
    source_ids = [r["source_field_id"] for r in rows]
    geom_hashes = [r["geometry_hash"] for r in rows]

    n_unique_internal_ids = len(set(internal_ids))
    n_unique_geometries = len(set(geom_hashes))
    geom_counts = Counter(geom_hashes)
    n_duplicate_geometries = sum(1 for c in geom_counts.values() if c > 1)

    # same source_field_id, different geometry_hash -> the original collision bug
    by_source_id: dict[str, set[str]] = {}
    for sid, gh in zip(source_ids, geom_hashes):
        by_source_id.setdefault(sid, set()).add(gh)
    n_same_id_diff_geometry = sum(1 for gh_set in by_source_id.values() if len(gh_set) > 1)

    # same geometry_hash, different source_field_id -> a real parcel declared under two admin codes
    by_geometry: dict[str, set[str]] = {}
    for sid, gh in zip(source_ids, geom_hashes):
        by_geometry.setdefault(gh, set()).add(sid)
    n_same_geometry_diff_id = sum(1 for sid_set in by_geometry.values() if len(sid_set) > 1)

    print("\n[ingest_eurocrops] === QC: field_id uniqueness ===")
    print(f"  source rows (real sunflower shapefile records): {n_source_rows}")
    print(f"  unique internal field_ids (source_field_id + geometry_hash): {n_unique_internal_ids}")
    print(f"  unique geometries (by geometry_hash): {n_unique_geometries}")
    print(f"  geometries appearing more than once (true duplicate polygons): {n_duplicate_geometries}")
    print(f"  same source_field_id groups spanning >1 distinct geometry (the original collision bug): {n_same_id_diff_geometry}")
    print(f"  distinct geometries sharing >1 source_field_id: {n_same_geometry_diff_id}")
    assert n_unique_internal_ids == n_source_rows, (
        f"internal field_id is not unique: {n_source_rows} rows but only {n_unique_internal_ids} unique ids "
        "(would mean two rows share BOTH source_field_id and geometry_hash)"
    )
    print("  PASS: every real source row now has a globally unique internal field_id.")


if __name__ == "__main__":
    main()
