"""Pydantic modelleri (JSON alan adları camelCase — sözleşme bölüm 1)."""
from __future__ import annotations

from typing import Any, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ErrorResponse(CamelModel):
    message: str


class ModelsHealth(CamelModel):
    plate_detector: bool
    vehicle_detector: bool
    ocr: Literal["easyocr", "yolo-char", "none"]


class HealthResponse(CamelModel):
    status: str = "ok"
    models: ModelsHealth
    # Sözleşme dışı ek bilgiler (arayüz yok sayabilir)
    details: Optional[dict] = None
    agents: int = 0


class AgentInfo(CamelModel):
    id: str
    type: Literal["Gate", "Occupancy"]
    gate: Optional[Literal["Entry", "Exit"]] = None
    source: str
    enabled: bool
    status: Literal["Stopped", "Running", "Error"]
    fps: float = 0.0
    camera_fps: float = 0.0
    lot_code: Optional[str] = None
    last_plate: Optional[str] = None
    last_error: Optional[str] = None


class PlateItem(CamelModel):
    plate: str
    raw_text: str
    confidence: float = Field(ge=0, le=1)
    format_valid: bool
    bbox: List[int]
    detection_confidence: Optional[float] = None
    ocr_confidence: Optional[float] = None


class RecognizeResponse(CamelModel):
    plates: List[PlateItem]
    backend_response: Optional[Any] = None
    elapsed_ms: float
    annotated_image_base64: Optional[str] = None
    ocr: Optional[str] = None
    message: Optional[str] = None


class SlotState(CamelModel):
    code: str
    occupied: bool
    confidence: float = Field(ge=0, le=1)


class OccupancyAnalyzeResponse(CamelModel):
    slots: List[SlotState]
    vehicles: int
    annotated_image_base64: Optional[str] = None
    elapsed_ms: float
    backend_response: Optional[Any] = None


class PlateEventPayload(CamelModel):
    """Backend'e gönderilen plaka olayı (sözleşme bölüm 3)."""
    camera_id: str
    gate: Literal["Entry", "Exit"]
    plate: str
    confidence: float = Field(ge=0, le=1)
    format_valid: bool
    timestamp: str
    image_base64: Optional[str] = None


class OccupancyPayload(CamelModel):
    camera_id: str
    timestamp: str
    slots: List[SlotState]
