"""
The FieldExample training-data schema — every row in every dataset this pipeline consumes
(real AMED-confirmed negatives, real Sunflower positives once obtained, anything from a
third-party source) must conform to this shape, with full provenance. Nothing here invents
data; it only defines and validates the shape real data must arrive in.

Distinguishes `bloom_date_source` explicitly: 'observed' (someone recorded a real flowering
date) vs 'estimated' (derived from a real satellite time series via a documented phenology
method) vs None (unknown) — these must never be conflated, per the explicit requirement that
an estimated bloom date carry weaker evidentiary weight than an observed one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

BloomDateSource = Literal["observed", "estimated"]
GeometrySource = Literal["alu", "third_party_polygon", "point_only"]
LabelSource = Literal[
    "amed_confirmed_negative",  # this app's own live AMED data — real, in production use today
    "haryana_harsac_2024",  # Kumar/Singh et al. 2024 — pending author response, not yet obtained
    "eurocrops_slovakia_2021",  # REAL, obtained (see ingest_eurocrops.py) — EUROPEAN. Pipeline/
    # development use ONLY — never a production Indian claim. See country field on every row.
]


@dataclass(frozen=True)
class FieldExample:
    field_id: str
    latitude: float
    longitude: float
    crop_label: str
    label_source: LabelSource
    country: str
    state: str
    season: str
    year: int
    geometry_source: GeometrySource
    # Optional / not always available — a missing value stays None, never a guessed default.
    polygon: Optional[dict] = None  # GeoJSON geometry, when a real polygon exists
    district: Optional[str] = None
    label_quality: Optional[str] = None  # free-text provenance note, e.g. "farmer-confirmed"
    sowing_date: Optional[str] = None  # ISO date
    flowering_date: Optional[str] = None  # ISO date
    bloom_date_source: Optional[BloomDateSource] = None
    harvest_date: Optional[str] = None  # ISO date
    satellite_source: Optional[str] = None  # e.g. "sentinel2_gee", set once real extraction runs

    def __post_init__(self) -> None:
        if not (-90 <= self.latitude <= 90):
            raise ValueError(f"invalid latitude {self.latitude} for field {self.field_id}")
        if not (-180 <= self.longitude <= 180):
            raise ValueError(f"invalid longitude {self.longitude} for field {self.field_id}")
        if self.flowering_date and not self.bloom_date_source:
            raise ValueError(
                f"field {self.field_id} has a flowering_date but no bloom_date_source — "
                "every flowering date must be tagged 'observed' or 'estimated', never ambiguous"
            )
        if self.crop_label == "SUNFLOWER" and self.label_source == "amed_confirmed_negative":
            # AMED has never returned SUNFLOWER in any real data seen by this application — if
            # this ever fires, it means either AMED's crop vocabulary changed or an ingestion
            # bug mislabeled a row. Either way, treat it as an error to investigate, not silently
            # accept a real-but-surprising positive from what's supposed to be the negative pool.
            raise ValueError(f"field {self.field_id}: unexpected SUNFLOWER label from an AMED-negative source")


REQUIRED_JSONL_FIELDS = {"field_id", "latitude", "longitude", "crop_label", "label_source", "country", "state", "season", "year", "geometry_source"}


def field_example_from_dict(row: dict) -> FieldExample:
    """Constructs a validated FieldExample from a raw JSONL row. Raises on any missing required
    field or invalid value rather than silently filling in a default — a malformed real row
    should fail loudly, not become a fabricated example."""
    missing = REQUIRED_JSONL_FIELDS - row.keys()
    if missing:
        raise ValueError(f"row missing required fields {missing}: {row.get('field_id', '<no field_id>')}")

    return FieldExample(
        field_id=row["field_id"],
        latitude=row["latitude"],
        longitude=row["longitude"],
        crop_label=row["crop_label"],
        label_source=row["label_source"],
        country=row["country"],
        state=row["state"],
        season=row["season"],
        year=row["year"],
        geometry_source=row["geometry_source"],
        polygon=row.get("polygon"),
        district=row.get("district"),
        label_quality=row.get("label_quality"),
        sowing_date=row.get("sowing_date"),
        flowering_date=row.get("flowering_date"),
        bloom_date_source=row.get("bloom_date_source"),
        harvest_date=row.get("harvest_date"),
        satellite_source=row.get("satellite_source"),
    )
