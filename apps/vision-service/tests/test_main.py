import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import caminho_permitido, criar_app, main
from app.rostos import ErroSelfie, Rosto
from tests.auxiliares import config_teste, salvar_jpeg

GPU_FALSA = {"vram_usada_mb": 1000, "vram_total_mb": 12282, "utilizacao": 37}


class MotorFalso:
    providers = {"detector": ["CPUExecutionProvider"], "reconhecedor": ["CPUExecutionProvider"]}

    def __init__(self):
        self.lotes = []

    def detectar_lote(self, imagens, tempos=None):
        self.lotes.append(len(imagens))
        return [
            [
                Rosto(
                    bbox=[1.0, 2.0, 30.0, 40.0],
                    kps=[[5.0, 6.0]] * 5,
                    det_score=0.9,
                    area_px=1102,
                    kps_decodificado=np.zeros((5, 2), np.float32),
                    embedding=[0.1] * 512,
                )
            ]
            for _ in imagens
        ]

    def embed_selfie(self, imagem):
        if imagem.largura < 100:
            raise ErroSelfie("rosto_pequeno")
        return {"embedding": [0.2] * 512, "det_score": 0.91, "largura_rosto": 150.0, "nitidez": 88.0}


@pytest.fixture
def pasta(tmp_path):
    salvar_jpeg(tmp_path / "a.jpg", np.full((300, 400, 3), 90, np.uint8))
    salvar_jpeg(tmp_path / "b.jpg", np.full((200, 100, 3), 90, np.uint8))
    salvar_jpeg(tmp_path / "mini.jpg", np.full((50, 50, 3), 90, np.uint8))
    (tmp_path / "ruim.jpg").write_bytes(b"nao e jpeg")
    return tmp_path


def cliente(modo, pasta, motor=None):
    config = config_teste(VISION_MODO=modo, VISION_RAIZES=str(pasta))
    return TestClient(criar_app(config, motor or MotorFalso(), gpu_info=lambda: GPU_FALSA))


def test_detect_responde_na_ordem_com_erro_por_imagem(pasta):
    motor = MotorFalso()
    with cliente("gpu", pasta, motor) as c:
        resposta = c.post(
            "/detect",
            json={"caminhos": [str(pasta / "a.jpg"), str(pasta / "ruim.jpg"), "/etc/passwd", str(pasta / "b.jpg")]},
        )

    assert resposta.status_code == 200
    a, ruim, fora, b = resposta.json()["resultados"]
    assert (a["largura"], a["altura"]) == (400, 300)
    assert a["rostos"][0] == {
        "embedding": [0.1] * 512,
        "bbox": [1.0, 2.0, 30.0, 40.0],
        "det_score": 0.9,
        "kps": [[5.0, 6.0]] * 5,
        "area_px": 1102,
    }
    assert ruim == {"caminho": str(pasta / "ruim.jpg"), "erro": "arquivo não é um JPEG válido", "rostos": []}
    assert fora["erro"] == "caminho fora da área permitida"
    assert (b["largura"], b["altura"]) == (100, 200)
    assert sum(motor.lotes) == 2


def test_detect_valida_a_entrada(pasta):
    with cliente("gpu", pasta) as c:
        assert c.post("/detect", json={"caminhos": []}).status_code == 422


def test_modo_gpu_nao_expoe_selfie(pasta):
    with cliente("gpu", pasta) as c:
        assert c.post("/embed-selfie", json={"caminho": str(pasta / "a.jpg")}).status_code == 404


def test_modo_selfie_nao_expoe_detect(pasta):
    with cliente("selfie-cpu", pasta) as c:
        assert c.post("/detect", json={"caminhos": [str(pasta / "a.jpg")]}).status_code == 404


def test_embed_selfie_valida(pasta):
    with cliente("selfie-cpu", pasta) as c:
        resposta = c.post("/embed-selfie", json={"caminho": str(pasta / "a.jpg")})

    assert resposta.status_code == 200
    assert resposta.json()["det_score"] == 0.91
    assert len(resposta.json()["embedding"]) == 512


@pytest.mark.parametrize(
    "arquivo, codigo",
    [("mini.jpg", "rosto_pequeno"), ("ruim.jpg", "arquivo_invalido"), ("/etc/hostname", "caminho_invalido")],
)
def test_embed_selfie_recusada(pasta, arquivo, codigo):
    caminho = arquivo if arquivo.startswith("/") else str(pasta / arquivo)
    with cliente("selfie-cpu", pasta) as c:
        resposta = c.post("/embed-selfie", json={"caminho": caminho})

    assert resposta.status_code == 422
    assert resposta.json()["codigo"] == codigo
    assert resposta.json()["msg"]


def test_health_no_modo_gpu(pasta):
    with cliente("gpu", pasta) as c:
        corpo = c.get("/health").json()

    assert corpo == {
        "modo": "gpu",
        "modelo": "buffalo_l",
        "providers": MotorFalso.providers,
        "gpu": GPU_FALSA,
        "fila": 0,
    }


def test_health_no_modo_selfie_nao_consulta_a_gpu(pasta):
    with cliente("selfie-cpu", pasta) as c:
        corpo = c.get("/health").json()

    assert corpo["modo"] == "selfie-cpu"
    assert corpo["gpu"] is None


@pytest.mark.parametrize(
    "caminho, esperado",
    [("/data/a.jpg", True), ("/data", True), ("/data/../etc/passwd", False), ("/dataset/a.jpg", False), ("/etc/a", False)],
)
def test_caminho_permitido(caminho, esperado):
    assert caminho_permitido(caminho, ("/data",)) is esperado


def test_main_sai_com_erro_sem_modo(monkeypatch):
    monkeypatch.delenv("VISION_MODO", raising=False)

    with pytest.raises(SystemExit) as saida:
        main()
    assert saida.value.code == 1


@pytest.mark.modelos
def test_embed_selfie_com_modelos_reais(motor, selfies):
    import os

    config = config_teste(VISION_RAIZES=os.path.dirname(selfies["unico"]))
    with TestClient(criar_app(config, motor, gpu_info=lambda: None)) as c:
        ok = c.post("/embed-selfie", json={"caminho": selfies["unico"]})
        dois = c.post("/embed-selfie", json={"caminho": selfies["dois"]})

    assert ok.status_code == 200
    assert len(ok.json()["embedding"]) == 512
    assert dois.status_code == 422
    assert dois.json()["codigo"] == "varios_rostos"
