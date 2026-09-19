import io
import math
from dataclasses import dataclass

import numpy as np
from PIL import Image
from turbojpeg import TurboJPEG

TAG_ORIENTACAO = 0x0112


class ErroImagem(Exception):
    pass


@dataclass
class ImagemDecodificada:
    pixels: np.ndarray
    largura: int
    altura: int
    escala: float


_jpeg: TurboJPEG | None = None


def _turbo() -> TurboJPEG:
    global _jpeg
    if _jpeg is None:
        _jpeg = TurboJPEG()
    return _jpeg


def escolher_fator(largura: int, altura: int, min_lado: int, fatores) -> tuple[int, int]:
    lado = max(largura, altura)
    candidatos = [f for f in fatores if f[0] <= f[1] and math.ceil(lado * f[0] / f[1]) >= min_lado]
    if not candidatos:
        return (1, 1)
    return min(candidatos, key=lambda f: f[0] / f[1])


def aplicar_orientacao(pixels: np.ndarray, orientacao: int) -> np.ndarray:
    if orientacao == 2:
        pixels = pixels[:, ::-1]
    elif orientacao == 3:
        pixels = pixels[::-1, ::-1]
    elif orientacao == 4:
        pixels = pixels[::-1]
    elif orientacao == 5:
        pixels = pixels.transpose(1, 0, 2)
    elif orientacao == 6:
        pixels = np.rot90(pixels, -1)
    elif orientacao == 7:
        pixels = np.rot90(pixels, 2).transpose(1, 0, 2)
    elif orientacao == 8:
        pixels = np.rot90(pixels, 1)
    return np.ascontiguousarray(pixels)


def _orientacao(dados: bytes) -> int:
    try:
        with Image.open(io.BytesIO(dados)) as imagem:
            return int(imagem.getexif().get(TAG_ORIENTACAO, 1))
    except Exception:
        return 1


def decodificar(caminho: str, min_lado: int | None) -> ImagemDecodificada:
    try:
        with open(caminho, "rb") as arquivo:
            dados = arquivo.read()
    except OSError as erro:
        raise ErroImagem(f"não foi possível ler o arquivo: {erro.strerror}") from None

    jpeg = _turbo()
    try:
        largura, altura, _, _ = jpeg.decode_header(dados)
        fator = (1, 1) if min_lado is None else escolher_fator(largura, altura, min_lado, jpeg.scaling_factors)
        pixels = jpeg.decode(dados, scaling_factor=fator)
    except Exception as erro:
        raise ErroImagem("arquivo não é um JPEG válido") from erro

    orientacao = _orientacao(dados)
    pixels = aplicar_orientacao(pixels, orientacao)
    if orientacao in (5, 6, 7, 8):
        largura, altura = altura, largura

    return ImagemDecodificada(pixels=pixels, largura=largura, altura=altura, escala=pixels.shape[1] / largura)
