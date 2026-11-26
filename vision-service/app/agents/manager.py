"""Ajan yöneticisi: config/cameras.yaml'dan ajanları oluşturur, başlatır/durdurur ve
her HEARTBEAT_INTERVAL saniyede bir backend'e heartbeat gönderir."""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.agents.base_agent import BaseCameraAgent
from app.agents.gate_agent import GateAgent
from app.agents.occupancy_agent import OccupancyAgent
from app.agents.voting import PlateVoter
from app.backend_client import BackendClient
from app.config import Settings
from app.model_registry import ModelRegistry

log = logging.getLogger(__name__)


def load_camera_config(path: Path) -> List[Dict[str, Any]]:
    """cameras.yaml dosyasını okur; dosya yoksa ya da hatalıysa boş liste döner."""
    if not path.exists():
        log.warning("Kamera yapılandırması bulunamadı: %s (ajan oluşturulmadı)", path)
        return []
    try:
        import yaml  # tembel import
    except ImportError:
        log.error("pyyaml kurulu değil; kameralar yüklenemedi (pip install pyyaml)")
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except Exception as exc:
        log.error("cameras.yaml okunamadı: %s", exc)
        return []
    cams = data.get("cameras", []) if isinstance(data, dict) else data
    return [c for c in (cams or []) if isinstance(c, dict) and c.get("id")]


class AgentManager:
    def __init__(self, settings: Settings, registry: ModelRegistry, backend: Optional[BackendClient]):
        self.settings = settings
        self.registry = registry
        self.backend = backend
        self.agents: Dict[str, BaseCameraAgent] = {}
        self._hb_stop = threading.Event()
        self._hb_thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------------
    def build_agent(self, cfg: Dict[str, Any]) -> BaseCameraAgent:
        s = self.settings
        agent_type = str(cfg.get("type", "Gate")).capitalize()
        common = dict(
            source=cfg.get("source", "0"),
            enabled=bool(cfg.get("enabled", False)),
            name=cfg.get("name"),
            lot_code=str(cfg.get("lotCode", "GAZI")),
        )
        if agent_type == "Gate":
            voter = PlateVoter(
                window_seconds=float(cfg.get("voteWindowSeconds", s.VOTE_WINDOW_SECONDS)),
                min_reads=int(cfg.get("voteMinReads", s.VOTE_MIN_READS)),
                cooldown_seconds=float(cfg.get("cooldownSeconds", s.PLATE_COOLDOWN_SECONDS)),
                invalid_cooldown_seconds=float(cfg.get("invalidCooldownSeconds", s.INVALID_COOLDOWN_SECONDS)),
            )
            return GateAgent(
                str(cfg["id"]), gate=str(cfg.get("gate", "Entry")), registry=self.registry, backend=self.backend,
                voter=voter, send_crop=bool(cfg.get("sendCrop", s.SEND_PLATE_CROP)), roi=cfg.get("roi"),
                target_fps=float(cfg.get("fps", 5)), **common)
        if agent_type == "Occupancy":
            slots_file = cfg.get("slotsFile")
            return OccupancyAgent(
                str(cfg["id"]), registry=self.registry, backend=self.backend,
                slots_file=s.path(slots_file) if slots_file else s.slots_file,
                threshold=float(cfg.get("threshold", s.OCCUPANCY_THRESHOLD)),
                smoothing=int(cfg.get("smoothing", s.OCCUPANCY_SMOOTHING)),
                full_report_seconds=float(cfg.get("fullReportSeconds", s.OCCUPANCY_FULL_REPORT_SECONDS)),
                vehicle_conf=float(cfg.get("vehicleConfidence", s.VEHICLE_CONFIDENCE)),
                footprint=float(cfg.get("footprint", s.OCCUPANCY_FOOTPRINT)),
                target_fps=float(cfg.get("fps", 1)), **common)
        raise ValueError(f"Bilinmeyen ajan türü: {cfg.get('type')} (Gate | Occupancy)")

    def load(self) -> None:
        for cfg in load_camera_config(self.settings.cameras_file):
            try:
                agent = self.build_agent(cfg)
            except Exception as exc:
                log.error("Ajan oluşturulamadı (%s): %s", cfg.get("id"), exc)
                continue
            if agent.id in self.agents:
                log.error("Yinelenen ajan kimliği atlandı: %s", agent.id)
                continue
            self.agents[agent.id] = agent
        log.info("%d ajan tanımlandı: %s", len(self.agents), ", ".join(self.agents) or "-")

    # ------------------------------------------------------------------
    def start_enabled(self) -> None:
        started_webcam_gates = set()
        for agent in self.agents.values():
            if not agent.enabled:
                continue
            if agent.agent_type == "Gate" and isinstance(agent.source, int):
                if agent.source in started_webcam_gates:
                    log.warning("[%s] aynı webcam'i (%s) kullanan başka bir giriş/çıkış ajanı zaten açık; "
                                "bu ajan otomatik başlatılmadı (Kamera Testi'nden geçiş yapın)", agent.id, agent.source)
                    continue
                started_webcam_gates.add(agent.source)
            agent.start()

    def start_heartbeat(self) -> None:
        if self.backend is None or (self._hb_thread and self._hb_thread.is_alive()):
            return
        self._hb_stop.clear()
        self._hb_thread = threading.Thread(target=self._heartbeat_loop, name="heartbeat", daemon=True)
        self._hb_thread.start()

    def _heartbeat_loop(self) -> None:
        while not self._hb_stop.is_set():
            try:
                self.backend.send_heartbeat(self.heartbeat_payload())
            except Exception as exc:  # heartbeat asla servisi düşürmesin
                log.debug("Heartbeat hatası: %s", exc)
            self._hb_stop.wait(self.settings.HEARTBEAT_INTERVAL)

    def heartbeat_payload(self) -> List[Dict[str, Any]]:
        return [a.heartbeat_info() for a in self.agents.values()]

    def get(self, agent_id: str) -> Optional[BaseCameraAgent]:
        return self.agents.get(agent_id)

    def list_info(self) -> List[Dict[str, Any]]:
        return [a.info() for a in self.agents.values()]

    def start(self, agent_id: str) -> Optional[BaseCameraAgent]:
        agent = self.agents.get(agent_id)
        if agent:
            self._stop_conflicting_gates(agent)
            agent.start()
        return agent

    def _stop_conflicting_gates(self, agent: BaseCameraAgent) -> None:
        """Aynı webcam'i kullanan giriş ve çıkış ajanı aynı anda çalışırsa her plaka hem giriş hem çıkış
        sayılır. Bu yüzden tek kamerayla test ederken birini başlatmak diğerini durdurur."""
        if agent.agent_type != "Gate" or not isinstance(agent.source, int):
            return
        for other in self.agents.values():
            if other is agent or other.agent_type != "Gate" or other.source != agent.source:
                continue
            if other.running:
                log.info("[%s] aynı kamerayı (%s) kullandığı için durduruldu; şimdi %s çalışıyor",
                         other.id, agent.source, agent.id)
                other.stop()

    def stop(self, agent_id: str) -> Optional[BaseCameraAgent]:
        agent = self.agents.get(agent_id)
        if agent:
            agent.stop()
        return agent

    def shutdown(self) -> None:
        self._hb_stop.set()
        for agent in self.agents.values():
            try:
                agent.stop(timeout=3)
            except Exception:
                pass
