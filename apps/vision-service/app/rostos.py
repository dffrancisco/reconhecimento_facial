from dataclasses import dataclass

import cv2
import numpy as np

MENSAGENS_SELFIE = {
    "sem_rosto": "Não encontramos um rosto na foto. Tire outra selfie de frente, com o rosto visível.",
    "varios_rostos": "Encontramos mais de um rosto. Tire uma selfie só sua.",
    "baixa_confianca": "Não conseguimos ver bem o seu rosto. Tire outra selfie de frente e com boa luz.",
    "rosto_pequeno": "Seu rosto ficou pequeno na foto. Aproxime a câmera e tente de novo.",
    "borrada": "A foto ficou tremida. Segure o celular firme e tente de novo.",
}

# Um segundo rosto com pelo menos 40% da área do maior não é "alguém ao fundo".
PROPORCAO_SEGUNDO_ROSTO = 0.4


class ErroSelfie(Exception):
    def __init__(self, codigo: str):
        super().__init__(MENSAGENS_SELFIE[codigo])
        self.codigo = codigo


@dataclass
class Rosto:
    bbox: list[float]
    kps: list[list[float]]
    det_score: float
    area_px: int
    kps_decodificado: np.ndarray
    embedding: list[float] | None = None


def converter_deteccoes(bboxes: np.ndarray, kpss: np.ndarray, escala: float) -> list[Rosto]:
    rostos = []
    for caixa, kps in zip(bboxes, kpss):
        x1, y1, x2, y2 = (float(v) / escala for v in caixa[:4])
        rostos.append(
            Rosto(
                bbox=[round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                kps=[[round(float(x) / escala, 1), round(float(y) / escala, 1)] for x, y in kps],
                det_score=round(float(caixa[4]), 4),
                area_px=int(round((x2 - x1) * (y2 - y1))),
                kps_decodificado=np.asarray(kps, dtype=np.float32),
            )
        )
    return rostos


def _lado(rosto: Rosto) -> float:
    x1, y1, x2, y2 = rosto.bbox
    return min(x2 - x1, y2 - y1)


def filtrar_rostos(rostos: list[Rosto], rosto_min_px: int, det_score_min: float) -> list[Rosto]:
    return [r for r in rostos if r.det_score >= det_score_min and _lado(r) >= rosto_min_px]


def escolher_rosto_selfie(rostos: list[Rosto], det_score_min: float, rosto_min_px: int) -> Rosto:
    if not rostos:
        raise ErroSelfie("sem_rosto")

    ordenados = sorted(rostos, key=lambda r: r.area_px, reverse=True)
    maior = ordenados[0]
    if len(ordenados) > 1 and ordenados[1].area_px >= PROPORCAO_SEGUNDO_ROSTO * maior.area_px:
        raise ErroSelfie("varios_rostos")
    if maior.det_score < det_score_min:
        raise ErroSelfie("baixa_confianca")
    if _lado(maior) < rosto_min_px:
        raise ErroSelfie("rosto_pequeno")
    return maior


def nitidez(pixels: np.ndarray, bbox: list[float], escala: float) -> float:
    altura, largura = pixels.shape[:2]
    x1, y1, x2, y2 = (int(round(v * escala)) for v in bbox)
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(largura, x2), min(altura, y2)
    if x2 <= x1 or y2 <= y1:
        return 0.0

    # Normalizar o recorte deixa a medida independente do tamanho do rosto na foto.
    recorte = cv2.resize(pixels[y1:y2, x1:x2], (112, 112), interpolation=cv2.INTER_AREA)
    cinza = cv2.cvtColor(recorte, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(cinza, cv2.CV_64F).var())
