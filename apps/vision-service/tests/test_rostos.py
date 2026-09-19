import cv2
import numpy as np
import pytest

from app.rostos import (
    MENSAGENS_SELFIE,
    ErroSelfie,
    Rosto,
    converter_deteccoes,
    escolher_rosto_selfie,
    filtrar_rostos,
    nitidez,
)


def _rosto(x1, y1, x2, y2, score=0.9):
    return Rosto(
        bbox=[x1, y1, x2, y2],
        kps=[[0.0, 0.0]] * 5,
        det_score=score,
        area_px=int((x2 - x1) * (y2 - y1)),
        kps_decodificado=np.zeros((5, 2), np.float32),
    )


def test_converter_leva_para_a_resolucao_original():
    bboxes = np.array([[10.0, 20.0, 60.0, 90.0, 0.87654]], np.float32)
    kpss = np.array([[[20, 40], [50, 40], [35, 55], [25, 70], [45, 70]]], np.float32)

    [rosto] = converter_deteccoes(bboxes, kpss, 0.5)

    assert rosto.bbox == [20.0, 40.0, 120.0, 180.0]
    assert rosto.kps[0] == [40.0, 80.0]
    assert rosto.det_score == pytest.approx(0.8765, abs=1e-4)
    assert rosto.area_px == 100 * 140
    assert np.array_equal(rosto.kps_decodificado, kpss[0])
    assert rosto.embedding is None


def test_converter_sem_deteccoes():
    assert converter_deteccoes(np.zeros((0, 5), np.float32), np.zeros((0, 5, 2), np.float32), 1.0) == []


def test_filtrar_por_score_e_por_tamanho():
    fraco = _rosto(0, 0, 100, 100, score=0.49)
    no_limite = _rosto(0, 0, 40, 60, score=0.5)
    estreito = _rosto(0, 0, 39.9, 100, score=0.99)
    bom = _rosto(0, 0, 80, 90, score=0.8)

    assert filtrar_rostos([fraco, no_limite, estreito, bom], 40, 0.5) == [no_limite, bom]


def test_selfie_sem_rosto():
    with pytest.raises(ErroSelfie) as erro:
        escolher_rosto_selfie([], 0.6, 80)
    assert erro.value.codigo == "sem_rosto"
    assert str(erro.value) == MENSAGENS_SELFIE["sem_rosto"]


def test_selfie_escolhe_o_maior_rosto_quando_o_outro_e_pequeno():
    maior = _rosto(0, 0, 200, 200)
    fundo = _rosto(300, 300, 425, 425)  # 39% da área do maior

    assert escolher_rosto_selfie([fundo, maior], 0.6, 80) is maior


def test_selfie_com_dois_rostos_parecidos():
    with pytest.raises(ErroSelfie) as erro:
        escolher_rosto_selfie([_rosto(0, 0, 200, 200), _rosto(300, 300, 427, 427)], 0.6, 80)
    assert erro.value.codigo == "varios_rostos"


def test_selfie_com_baixa_confianca():
    with pytest.raises(ErroSelfie) as erro:
        escolher_rosto_selfie([_rosto(0, 0, 200, 200, score=0.59)], 0.6, 80)
    assert erro.value.codigo == "baixa_confianca"


def test_selfie_com_rosto_pequeno():
    with pytest.raises(ErroSelfie) as erro:
        escolher_rosto_selfie([_rosto(0, 0, 79, 120)], 0.6, 80)
    assert erro.value.codigo == "rosto_pequeno"


def test_mensagens_para_todos_os_codigos():
    assert set(MENSAGENS_SELFIE) == {"sem_rosto", "varios_rostos", "baixa_confianca", "rosto_pequeno", "borrada"}


def test_nitidez_diferencia_nitida_de_borrada():
    xadrez = (np.indices((400, 400)).sum(axis=0) // 20 % 2 * 255).astype(np.uint8)
    nitida = cv2.cvtColor(xadrez, cv2.COLOR_GRAY2BGR)
    borrada = cv2.GaussianBlur(nitida, (0, 0), 20)

    assert nitidez(nitida, [50, 50, 350, 350], 1.0) > 1000
    assert nitidez(borrada, [50, 50, 350, 350], 1.0) < 30


def test_nitidez_usa_a_escala_da_imagem_decodificada():
    xadrez = (np.indices((200, 200)).sum(axis=0) // 10 % 2 * 255).astype(np.uint8)
    pixels = cv2.cvtColor(xadrez, cv2.COLOR_GRAY2BGR)

    # bbox na resolução original (o dobro); a escala 0.5 traz de volta para os pixels decodificados.
    assert nitidez(pixels, [0, 0, 400, 400], 0.5) == pytest.approx(nitidez(pixels, [0, 0, 200, 200], 1.0))


def test_nitidez_de_recorte_vazio_e_zero():
    assert nitidez(np.zeros((100, 100, 3), np.uint8), [150, 150, 180, 180], 1.0) == 0.0
