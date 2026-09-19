import numpy as np
import pytest

from app import motor as motor_mod
from app.motor import DETECTOR, RECONHECEDOR, ErroInicializacao, Motor, carregar_motor, providers_do_modo
from tests.auxiliares import config_teste


class SessaoFalsa:
    def __init__(self, providers):
        self._providers = providers

    def get_providers(self):
        return self._providers


class ModeloFalso:
    def __init__(self, providers):
        self.session = SessaoFalsa(providers)
        self.preparado = None
        self.chamadas_detect = []
        self.chamadas_get_feat = []

    def prepare(self, ctx_id, **kwargs):
        self.preparado = {"ctx_id": ctx_id, **kwargs}

    def detect(self, pixels, input_size):
        self.chamadas_detect.append(input_size)
        return np.zeros((0, 5), np.float32), np.zeros((0, 5, 2), np.float32)

    def get_feat(self, recortes):
        self.chamadas_get_feat.append(len(recortes))
        return np.zeros((len(recortes), 512), np.float32)


def fabrica_com(ativos):
    chamadas = []

    def fabrica(caminho, **kwargs):
        chamadas.append((caminho, kwargs))
        return ModeloFalso(ativos)

    fabrica.chamadas = chamadas
    return fabrica


@pytest.fixture
def modelos_vazios(tmp_path):
    (tmp_path / DETECTOR).write_bytes(b"")
    (tmp_path / RECONHECEDOR).write_bytes(b"")
    return str(tmp_path)


def test_gpu_sem_cuda_encerra_com_erro(modelos_vazios):
    config = config_teste(VISION_MODO="gpu", VISION_MODELOS_DIR=modelos_vazios)

    with pytest.raises(ErroInicializacao, match="exige CUDAExecutionProvider") as erro:
        carregar_motor(config, fabrica=fabrica_com(["CPUExecutionProvider"]))
    assert "detector" in str(erro.value)


def test_gpu_com_cuda_prepara_o_detector_para_o_det_size(modelos_vazios):
    config = config_teste(VISION_MODO="gpu", VISION_MODELOS_DIR=modelos_vazios)
    fabrica = fabrica_com(["CUDAExecutionProvider", "CPUExecutionProvider"])

    motor = carregar_motor(config, fabrica=fabrica)

    assert motor.detector.preparado == {"ctx_id": 0, "input_size": (1024, 1024), "det_thresh": 0.5}
    assert fabrica.chamadas[0][1]["providers"] == ["CUDAExecutionProvider", "CPUExecutionProvider"]
    assert motor.providers["reconhecedor"] == ["CUDAExecutionProvider", "CPUExecutionProvider"]


def test_selfie_cpu_declara_so_a_cpu(modelos_vazios):
    config = config_teste(VISION_MODELOS_DIR=modelos_vazios)
    fabrica = fabrica_com(["CPUExecutionProvider"])

    motor = carregar_motor(config, fabrica=fabrica)

    assert fabrica.chamadas[0][1]["providers"] == ["CPUExecutionProvider"]
    assert motor.detector.preparado == {"ctx_id": -1, "input_size": (640, 640), "det_thresh": 0.3}


def test_selfie_cpu_recusa_sessao_em_outro_provider(modelos_vazios):
    config = config_teste(VISION_MODELOS_DIR=modelos_vazios)

    with pytest.raises(ErroInicializacao, match="selfie-cpu exige só CPUExecutionProvider"):
        carregar_motor(config, fabrica=fabrica_com(["CUDAExecutionProvider", "CPUExecutionProvider"]))


def test_tensorrt_exige_o_provider_tensorrt(modelos_vazios):
    config = config_teste(VISION_MODO="gpu", VISION_TENSORRT="true", VISION_MODELOS_DIR=modelos_vazios)

    with pytest.raises(ErroInicializacao, match="exige TensorrtExecutionProvider"):
        carregar_motor(config, fabrica=fabrica_com(["CUDAExecutionProvider", "CPUExecutionProvider"]))


def test_providers_do_tensorrt_com_fp16_e_cache():
    config = config_teste(VISION_MODO="gpu", VISION_TENSORRT="true", VISION_TENSORRT_CACHE="/cache/trt")

    nomes, opcoes = providers_do_modo(config)

    assert nomes == ["TensorrtExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"]
    assert opcoes[0] == {
        "trt_fp16_enable": "True",
        "trt_engine_cache_enable": "True",
        "trt_engine_cache_path": "/cache/trt",
    }


def test_modelo_ausente(tmp_path):
    config = config_teste(VISION_MODELOS_DIR=str(tmp_path))

    with pytest.raises(ErroInicializacao, match="Modelo não encontrado"):
        carregar_motor(config, fabrica=fabrica_com(["CPUExecutionProvider"]))


def test_carregar_motor_aquece_detector_e_reconhecedor(modelos_vazios):
    config = config_teste(VISION_MODELOS_DIR=modelos_vazios)

    motor = carregar_motor(config, fabrica=fabrica_com(["CPUExecutionProvider"]))

    assert motor.detector.chamadas_detect == [(motor.tamanho, motor.tamanho)]
    assert motor.reconhecedor.chamadas_get_feat == [1]


def test_detectar_lote_vazio_nao_chama_o_reconhecedor(modelos_vazios):
    motor = carregar_motor(config_teste(VISION_MODELOS_DIR=modelos_vazios), fabrica=fabrica_com(["CPUExecutionProvider"]))

    def detect(pixels, input_size):
        return np.zeros((0, 5), np.float32), np.zeros((0, 5, 2), np.float32)

    motor.detector.detect = detect
    motor.reconhecedor.get_feat = lambda crops: pytest.fail("não deveria reconhecer sem rostos")

    from app.imagem import ImagemDecodificada

    assert motor.detectar_lote([ImagemDecodificada(np.zeros((10, 10, 3), np.uint8), 10, 10, 1.0)]) == [[]]


def test_embeddings_com_norma_zero_nao_vira_nan(monkeypatch):
    monkeypatch.setattr(motor_mod.face_align, "norm_crop", lambda pixels, kps: pixels)

    class ReconhecedorZero:
        def get_feat(self, recortes):
            return np.zeros((len(recortes), 512), np.float32)

    motor = Motor(config_teste(), detector=None, reconhecedor=ReconhecedorZero(), tamanho=640)

    [vetor] = motor._embeddings([(np.zeros((4, 4, 3), np.uint8), np.zeros((5, 2), np.float32))])

    assert not np.isnan(vetor).any()
    assert np.array_equal(vetor, np.zeros(512, np.float32))
