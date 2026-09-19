import os

import cv2

from app.config import Config, carregar_config


def config_teste(**env) -> Config:
    base = {"VISION_MODO": "selfie-cpu", "VISION_MODELOS_DIR": os.environ.get("VISION_MODELOS_DIR", "/modelos")}
    base.update(env)
    return carregar_config(base)


def salvar_jpeg(caminho, pixels) -> str:
    ok, buffer = cv2.imencode(".jpg", pixels, [cv2.IMWRITE_JPEG_QUALITY, 95])
    assert ok
    caminho.write_bytes(buffer.tobytes())
    return str(caminho)
