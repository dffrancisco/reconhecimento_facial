import os

import cv2
import numpy as np
import pytest
from insightface.data import get_image

from tests.auxiliares import config_teste, salvar_jpeg


@pytest.fixture(scope="session")
def t1():
    # Foto de grupo que vem com o insightface: 6 rostos, todos com lado > 90 px.
    return get_image("t1")


@pytest.fixture(scope="session")
def selfies(tmp_path_factory, t1):
    pasta = tmp_path_factory.mktemp("selfies")
    recorte = t1[180:500, 380:660]  # contém só o rosto de x≈466..574
    rosto = cv2.resize(recorte, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
    return {
        "unico": salvar_jpeg(pasta / "unico.jpg", rosto),
        "borrado": salvar_jpeg(pasta / "borrado.jpg", cv2.GaussianBlur(rosto, (0, 0), 8)),
        "pequeno": salvar_jpeg(pasta / "pequeno.jpg", cv2.resize(recorte, None, fx=0.4, fy=0.4)),
        "vazio": salvar_jpeg(pasta / "vazio.jpg", np.full((600, 600, 3), 128, np.uint8)),
        "dois": salvar_jpeg(pasta / "dois.jpg", cv2.resize(t1[200:500, 420:880], None, fx=2, fy=2)),
    }


@pytest.fixture(scope="session")
def motor():
    from app.motor import DETECTOR, carregar_motor

    config = config_teste()
    if not os.path.exists(os.path.join(config.modelos_dir, DETECTOR)):
        pytest.skip("modelos buffalo_l ausentes (rode com npm run test:vision)")
    return carregar_motor(config)
