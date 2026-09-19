import dataclasses

import cv2
import numpy as np
import pytest

from app.imagem import ImagemDecodificada, decodificar
from app.motor import Motor
from app.rostos import ErroSelfie
from tests.auxiliares import salvar_jpeg

pytestmark = pytest.mark.modelos


def _imagem(pixels):
    return ImagemDecodificada(pixels, pixels.shape[1], pixels.shape[0], 1.0)


def test_detecta_os_seis_rostos_com_embedding_normalizado(motor, t1):
    [rostos] = motor.detectar_lote([_imagem(t1)])

    assert len(rostos) == 6
    for rosto in rostos:
        assert len(rosto.embedding) == 512
        assert np.linalg.norm(rosto.embedding) == pytest.approx(1.0, abs=1e-3)
        assert len(rosto.kps) == 5
        assert rosto.det_score >= 0.5


def test_coordenadas_voltam_para_a_resolucao_original(motor, t1, tmp_path):
    grande = cv2.resize(t1, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
    img = decodificar(salvar_jpeg(tmp_path / "grande.jpg", grande), 1280)
    assert (img.largura, img.altura) == (5120, 3544)
    assert img.escala == pytest.approx(0.25)

    [rostos] = motor.detectar_lote([img])
    [referencia] = motor.detectar_lote([_imagem(t1)])

    assert len(rostos) == len(referencia) == 6
    for r in referencia:
        par = min(rostos, key=lambda g: abs(g.bbox[0] - 4 * r.bbox[0]) + abs(g.bbox[1] - 4 * r.bbox[1]))
        tolerancia = 4 * (r.bbox[2] - r.bbox[0]) * 0.1
        for obtido, original in zip(par.bbox, r.bbox):
            assert abs(obtido - 4 * original) < tolerancia


def test_tempos_por_etapa(motor, t1):
    tempos = {}
    motor.detectar_lote([_imagem(t1)], tempos)

    assert tempos["deteccao"] > 0
    assert tempos["reconhecimento"] > 0


def test_selfie_valida(motor, selfies):
    resultado = motor.embed_selfie(decodificar(selfies["unico"], None))

    assert len(resultado["embedding"]) == 512
    assert np.linalg.norm(resultado["embedding"]) == pytest.approx(1.0, abs=1e-3)
    assert resultado["det_score"] >= 0.8
    assert 240 <= resultado["largura_rosto"] <= 310
    assert resultado["nitidez"] > 30


def test_selfie_bate_com_a_mesma_pessoa_na_foto_de_grupo(motor, t1, selfies):
    selfie = np.array(motor.embed_selfie(decodificar(selfies["unico"], None))["embedding"])
    [rostos] = motor.detectar_lote([_imagem(t1)])

    def similaridade(rosto):
        return float(selfie @ np.array(rosto.embedding))

    mesma = [r for r in rostos if 380 <= r.bbox[0] <= 660 and 180 <= r.bbox[1] <= 500]
    outras = [r for r in rostos if r not in mesma]
    assert len(mesma) == 1
    assert similaridade(mesma[0]) > 0.6
    assert all(similaridade(r) < 0.45 for r in outras)


@pytest.mark.parametrize(
    "nome, codigo",
    [("vazio", "sem_rosto"), ("dois", "varios_rostos"), ("pequeno", "rosto_pequeno"), ("borrado", "borrada")],
)
def test_selfie_recusada(motor, selfies, nome, codigo):
    with pytest.raises(ErroSelfie) as erro:
        motor.embed_selfie(decodificar(selfies[nome], None))
    assert erro.value.codigo == codigo


def test_selfie_com_baixa_confianca(motor, selfies):
    exigente = Motor(
        dataclasses.replace(motor.config, selfie_det_score_min=0.95), motor.detector, motor.reconhecedor, motor.tamanho
    )

    with pytest.raises(ErroSelfie) as erro:
        exigente.embed_selfie(decodificar(selfies["unico"], None))
    assert erro.value.codigo == "baixa_confianca"
