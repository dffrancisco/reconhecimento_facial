import os

import pytest

from app.config import ErroConfig, carregar_config


def test_recusa_modo_ausente():
    with pytest.raises(ErroConfig, match='VISION_MODO deve ser "gpu" ou "selfie-cpu"'):
        carregar_config({})


def test_recusa_modo_invalido():
    with pytest.raises(ErroConfig, match='recebido: "cpu"'):
        carregar_config({"VISION_MODO": "cpu"})


def test_aplica_os_padroes_do_spec():
    c = carregar_config({"VISION_MODO": "gpu"})

    assert c.modo == "gpu"
    assert c.porta == 8000
    assert c.modelos_dir == "/modelos"
    assert c.raizes == ("/data",)
    assert c.tensorrt is False
    assert c.decode_threads == 8
    assert c.decode_min_lado == 2048
    assert c.lote_max == 16
    assert c.lote_espera_ms == 20
    assert c.det_size == 1024
    assert c.rosto_min_px == 40
    assert c.det_score_min == 0.5
    assert c.selfie_concorrencia == max(1, (os.cpu_count() or 2) - 1)
    assert c.selfie_det_score_min == 0.6
    assert c.selfie_rosto_min_px == 80
    assert c.selfie_nitidez_min == 30.0


def test_le_os_valores_informados():
    c = carregar_config(
        {
            "VISION_MODO": "selfie-cpu",
            "VISION_PORTA": "9000",
            "VISION_MODELOS_DIR": "/outro",
            "VISION_RAIZES": "/data/selfies:/tmp/extra",
            "VISION_TENSORRT": "true",
            "VISION_DET_SIZE": "640",
            "VISION_DET_SCORE_MIN": "0.7",
            "SELFIE_CONCORRENCIA": "3",
            "SELFIE_NITIDEZ_MIN": "12.5",
        }
    )

    assert c.porta == 9000
    assert c.modelos_dir == "/outro"
    assert c.raizes == ("/data/selfies", "/tmp/extra")
    assert c.tensorrt is True
    assert c.det_size == 640
    assert c.det_score_min == 0.7
    assert c.selfie_concorrencia == 3
    assert c.selfie_nitidez_min == 12.5


@pytest.mark.parametrize("valor", ["abc", "0", "-3", "1.5"])
def test_recusa_inteiro_invalido(valor):
    with pytest.raises(ErroConfig, match="VISION_LOTE_MAX deve ser um número inteiro positivo"):
        carregar_config({"VISION_MODO": "gpu", "VISION_LOTE_MAX": valor})


def test_recusa_real_invalido():
    with pytest.raises(ErroConfig, match="SELFIE_DET_SCORE_MIN deve ser um número >= 0"):
        carregar_config({"VISION_MODO": "gpu", "SELFIE_DET_SCORE_MIN": "alto"})


def test_det_size_precisa_ser_multiplo_de_32():
    with pytest.raises(ErroConfig, match="VISION_DET_SIZE deve ser múltiplo de 32"):
        carregar_config({"VISION_MODO": "gpu", "VISION_DET_SIZE": "1000"})


def test_recusa_booleano_invalido():
    with pytest.raises(ErroConfig, match='VISION_TENSORRT deve ser "true" ou "false"'):
        carregar_config({"VISION_MODO": "gpu", "VISION_TENSORRT": "sim"})
