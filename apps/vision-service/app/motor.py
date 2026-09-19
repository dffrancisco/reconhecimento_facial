import logging
import os
import time

import numpy as np
from insightface.model_zoo import get_model
from insightface.utils import face_align

from app.config import Config
from app.imagem import ImagemDecodificada
from app.rostos import (
    ErroSelfie,
    Rosto,
    converter_deteccoes,
    escolher_rosto_selfie,
    filtrar_rostos,
    nitidez,
)

log = logging.getLogger("vision")

DETECTOR = "det_10g.onnx"
RECONHECEDOR = "w600k_r50.onnx"
SELFIE_DET_SIZE = 640
# Na selfie o detector aceita score baixo para a validação responder "baixa_confianca" em vez de "sem_rosto".
SELFIE_DET_LIMIAR = 0.3
# Teto de recortes por chamada do ArcFace, para limitar a VRAM num lote com muitos rostos.
LOTE_RECONHECIMENTO = 128


class ErroInicializacao(Exception):
    pass


def providers_do_modo(config: Config) -> tuple[list[str], list[dict]]:
    if config.modo == "selfie-cpu":
        return ["CPUExecutionProvider"], [{}]
    if config.tensorrt:
        trt = {
            "trt_fp16_enable": "True",
            "trt_engine_cache_enable": "True",
            "trt_engine_cache_path": config.tensorrt_cache,
        }
        return ["TensorrtExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"], [trt, {}, {}]
    return ["CUDAExecutionProvider", "CPUExecutionProvider"], [{}, {}]


def conferir_providers(nome: str, ativos: list[str], config: Config) -> None:
    if config.modo == "selfie-cpu":
        if ativos != ["CPUExecutionProvider"]:
            raise ErroInicializacao(f"{nome}: VISION_MODO=selfie-cpu exige só CPUExecutionProvider, a sessão ficou com {ativos}")
        return

    exigido = "TensorrtExecutionProvider" if config.tensorrt else "CUDAExecutionProvider"
    if exigido not in ativos:
        raise ErroInicializacao(
            f"{nome}: VISION_MODO=gpu exige {exigido}, mas a sessão ONNX ficou com {ativos}. "
            "Confira o driver NVIDIA, o nvidia-container-toolkit e se a imagem foi construída com onnxruntime-gpu."
        )


class Motor:
    def __init__(self, config: Config, detector, reconhecedor, tamanho: int):
        self.config = config
        self.detector = detector
        self.reconhecedor = reconhecedor
        self.tamanho = tamanho

    @property
    def providers(self) -> dict[str, list[str]]:
        return {
            "detector": list(self.detector.session.get_providers()),
            "reconhecedor": list(self.reconhecedor.session.get_providers()),
        }

    def _detectar(self, imagem: ImagemDecodificada) -> list[Rosto]:
        bboxes, kpss = self.detector.detect(imagem.pixels, input_size=(self.tamanho, self.tamanho))
        return converter_deteccoes(bboxes, kpss, imagem.escala)

    def _embeddings(self, itens: list[tuple[np.ndarray, np.ndarray]]) -> np.ndarray:
        if not itens:
            return np.zeros((0, 512), np.float32)
        recortes = [face_align.norm_crop(pixels, kps) for pixels, kps in itens]
        partes = [
            self.reconhecedor.get_feat(recortes[i : i + LOTE_RECONHECIMENTO])
            for i in range(0, len(recortes), LOTE_RECONHECIMENTO)
        ]
        vetores = np.concatenate(partes).astype(np.float32)
        return vetores / np.linalg.norm(vetores, axis=1, keepdims=True)

    def detectar_lote(self, imagens: list[ImagemDecodificada], tempos: dict | None = None) -> list[list[Rosto]]:
        inicio = time.perf_counter()
        por_imagem = [
            filtrar_rostos(self._detectar(img), self.config.rosto_min_px, self.config.det_score_min) for img in imagens
        ]
        meio = time.perf_counter()

        pares = [(img, rosto) for img, rostos in zip(imagens, por_imagem) for rosto in rostos]
        vetores = self._embeddings([(img.pixels, rosto.kps_decodificado) for img, rosto in pares])
        for (_, rosto), vetor in zip(pares, vetores):
            rosto.embedding = [round(float(v), 6) for v in vetor]

        if tempos is not None:
            tempos["deteccao"] = tempos.get("deteccao", 0.0) + meio - inicio
            tempos["reconhecimento"] = tempos.get("reconhecimento", 0.0) + time.perf_counter() - meio
        return por_imagem

    def embed_selfie(self, imagem: ImagemDecodificada) -> dict:
        rosto = escolher_rosto_selfie(
            self._detectar(imagem), self.config.selfie_det_score_min, self.config.selfie_rosto_min_px
        )
        valor = nitidez(imagem.pixels, rosto.bbox, imagem.escala)
        if valor < self.config.selfie_nitidez_min:
            raise ErroSelfie("borrada")

        [vetor] = self._embeddings([(imagem.pixels, rosto.kps_decodificado)])
        return {
            "embedding": [round(float(v), 6) for v in vetor],
            "det_score": rosto.det_score,
            "largura_rosto": round(rosto.bbox[2] - rosto.bbox[0], 1),
            "nitidez": round(valor, 1),
        }


def carregar_motor(config: Config, fabrica=get_model) -> Motor:
    nomes, opcoes = providers_do_modo(config)
    modelos = {}
    for chave, arquivo in (("detector", DETECTOR), ("reconhecedor", RECONHECEDOR)):
        caminho = os.path.join(config.modelos_dir, arquivo)
        if not os.path.exists(caminho):
            raise ErroInicializacao(f"Modelo não encontrado: {caminho}")
        modelos[chave] = fabrica(caminho, providers=nomes, provider_options=opcoes)
        conferir_providers(chave, list(modelos[chave].session.get_providers()), config)

    gpu = config.modo == "gpu"
    tamanho = config.det_size if gpu else SELFIE_DET_SIZE
    limiar = config.det_score_min if gpu else SELFIE_DET_LIMIAR
    ctx_id = 0 if gpu else -1
    modelos["detector"].prepare(ctx_id, input_size=(tamanho, tamanho), det_thresh=limiar)
    modelos["reconhecedor"].prepare(ctx_id)

    motor = Motor(config, modelos["detector"], modelos["reconhecedor"], tamanho)
    log.info("[Vision] Modo %s, det_size %s, providers %s", config.modo, tamanho, motor.providers)
    return motor
