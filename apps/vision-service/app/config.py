import math
import os
from collections.abc import Mapping
from dataclasses import dataclass

MODOS = ("gpu", "selfie-cpu")


class ErroConfig(Exception):
    pass


@dataclass(frozen=True)
class Config:
    modo: str
    porta: int
    modelos_dir: str
    raizes: tuple[str, ...]
    tensorrt: bool
    tensorrt_cache: str
    decode_threads: int
    decode_min_lado: int
    lote_max: int
    lote_espera_ms: int
    det_size: int
    rosto_min_px: int
    det_score_min: float
    selfie_concorrencia: int
    selfie_det_score_min: float
    selfie_rosto_min_px: int
    selfie_nitidez_min: float


def _inteiro(env: Mapping[str, str], nome: str, padrao: int) -> int:
    valor = env.get(nome)
    if valor in (None, ""):
        return padrao
    try:
        numero = int(valor)
    except ValueError:
        numero = 0
    if numero <= 0:
        raise ErroConfig(f"{nome} deve ser um número inteiro positivo (recebido: {valor!r})")
    return numero


def _real(env: Mapping[str, str], nome: str, padrao: float) -> float:
    valor = env.get(nome)
    if valor in (None, ""):
        return padrao
    try:
        numero = float(valor)
    except ValueError:
        numero = -1.0
    # "inf" e "nan" passam no float() e escapariam do "< 0" (nan não é maior nem menor que nada).
    if not math.isfinite(numero) or numero < 0:
        raise ErroConfig(f"{nome} deve ser um número >= 0 (recebido: {valor!r})")
    return numero


def _booleano(env: Mapping[str, str], nome: str) -> bool:
    valor = (env.get(nome) or "false").lower()
    if valor not in ("true", "false"):
        raise ErroConfig(f'{nome} deve ser "true" ou "false" (recebido: {valor!r})')
    return valor == "true"


def carregar_config(env: Mapping[str, str]) -> Config:
    modo = env.get("VISION_MODO", "")
    if modo not in MODOS:
        raise ErroConfig(f'VISION_MODO deve ser "gpu" ou "selfie-cpu" (recebido: "{modo}")')

    det_size = _inteiro(env, "VISION_DET_SIZE", 1024)
    # O SCRFD trabalha com strides 8/16/32: outro tamanho quebra a grade de âncoras.
    if det_size % 32:
        raise ErroConfig(f"VISION_DET_SIZE deve ser múltiplo de 32 (recebido: {det_size})")

    return Config(
        modo=modo,
        porta=_inteiro(env, "VISION_PORTA", 8000),
        modelos_dir=env.get("VISION_MODELOS_DIR") or "/modelos",
        raizes=tuple(r for r in (env.get("VISION_RAIZES") or "/data").split(":") if r),
        tensorrt=_booleano(env, "VISION_TENSORRT"),
        tensorrt_cache=env.get("VISION_TENSORRT_CACHE") or "/cache/tensorrt",
        decode_threads=_inteiro(env, "VISION_DECODE_THREADS", 8),
        decode_min_lado=_inteiro(env, "VISION_DECODE_MIN_LADO", 2048),
        lote_max=_inteiro(env, "VISION_LOTE_MAX", 16),
        lote_espera_ms=_inteiro(env, "VISION_LOTE_ESPERA_MS", 20),
        det_size=det_size,
        rosto_min_px=_inteiro(env, "VISION_ROSTO_MIN_PX", 40),
        det_score_min=_real(env, "VISION_DET_SCORE_MIN", 0.5),
        selfie_concorrencia=_inteiro(env, "SELFIE_CONCORRENCIA", max(1, (os.cpu_count() or 2) - 1)),
        selfie_det_score_min=_real(env, "SELFIE_DET_SCORE_MIN", 0.6),
        selfie_rosto_min_px=_inteiro(env, "SELFIE_ROSTO_MIN_PX", 80),
        selfie_nitidez_min=_real(env, "SELFIE_NITIDEZ_MIN", 30.0),
    )
