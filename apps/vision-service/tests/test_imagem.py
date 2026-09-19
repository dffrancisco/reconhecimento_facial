import numpy as np
import pytest
from PIL import Image

from app.imagem import ErroImagem, aplicar_orientacao, decodificar, escolher_fator

FATORES = {(1, 1), (1, 2), (1, 4), (1, 8), (3, 8), (5, 8), (7, 8), (3, 4), (2, 1), (15, 8)}


@pytest.mark.parametrize(
    "largura, altura, esperado",
    [
        (6000, 4000, (3, 8)),  # 2250 px, a maior redução que ainda passa de 2048
        (4000, 3000, (5, 8)),  # 1/2 daria 2000 px
        (4096, 2048, (1, 2)),  # 2048 px exatos
        (2000, 3000, (3, 4)),  # retrato: vale o lado maior
        (1500, 1000, (1, 1)),  # menor que o mínimo: nunca amplia
    ],
)
def test_escolher_fator(largura, altura, esperado):
    assert escolher_fator(largura, altura, 2048, FATORES) == esperado


TRANSPOSICOES = {
    2: Image.Transpose.FLIP_LEFT_RIGHT,
    3: Image.Transpose.ROTATE_180,
    4: Image.Transpose.FLIP_TOP_BOTTOM,
    5: Image.Transpose.TRANSPOSE,
    6: Image.Transpose.ROTATE_270,
    7: Image.Transpose.TRANSVERSE,
    8: Image.Transpose.ROTATE_90,
}


@pytest.mark.parametrize("orientacao", range(1, 9))
def test_aplicar_orientacao_igual_ao_pillow(orientacao):
    pixels = np.random.default_rng(orientacao).integers(0, 255, (5, 7, 3), dtype=np.uint8)
    esperado = pixels
    if orientacao in TRANSPOSICOES:
        esperado = np.asarray(Image.fromarray(pixels).transpose(TRANSPOSICOES[orientacao]))

    resultado = aplicar_orientacao(pixels, orientacao)

    assert np.array_equal(resultado, esperado)
    assert resultado.flags["C_CONTIGUOUS"]


def _salvar_jpeg(caminho, bgr, orientacao=None):
    imagem = Image.fromarray(np.ascontiguousarray(bgr[..., ::-1]))
    exif = Image.Exif()
    if orientacao:
        exif[0x0112] = orientacao
    imagem.save(caminho, quality=95, exif=exif)
    return str(caminho)


def _gradiente(altura, largura):
    x = np.linspace(0, 255, largura, dtype=np.float32)
    y = np.linspace(0, 255, altura, dtype=np.float32)[:, None]
    canal = ((x + y) / 2).astype(np.uint8)
    return np.dstack([canal, np.flipud(canal), np.fliplr(canal)])


def test_decodifica_reduzido_e_informa_a_escala(tmp_path):
    caminho = _salvar_jpeg(tmp_path / "grande.jpg", _gradiente(2048, 4096))

    img = decodificar(caminho, 2048)

    assert (img.largura, img.altura) == (4096, 2048)
    assert img.pixels.shape == (1024, 2048, 3)
    assert img.escala == pytest.approx(0.5)


def test_sem_min_lado_decodifica_em_tamanho_cheio(tmp_path):
    caminho = _salvar_jpeg(tmp_path / "selfie.jpg", _gradiente(400, 300))

    img = decodificar(caminho, None)

    assert img.pixels.shape == (400, 300, 3)
    assert img.escala == 1.0


def test_aplica_a_rotacao_exif_antes_de_tudo(tmp_path):
    em_pe = _gradiente(200, 300)
    em_pe[:40, :40] = (0, 0, 255)  # canto vermelho, para conferir o sentido
    # Gravado girado 90° anti-horário: a orientação 6 manda girar 90° horário para exibir.
    caminho = _salvar_jpeg(tmp_path / "girada.jpg", np.rot90(em_pe, 1), orientacao=6)

    img = decodificar(caminho, None)

    assert (img.largura, img.altura) == (300, 200)
    assert img.pixels.shape == (200, 300, 3)
    assert np.abs(img.pixels.astype(int) - em_pe.astype(int)).mean() < 8


def test_arquivo_que_nao_e_jpeg(tmp_path):
    caminho = tmp_path / "texto.jpg"
    caminho.write_bytes(b"isto nao e um jpeg")

    with pytest.raises(ErroImagem, match="não é um JPEG válido"):
        decodificar(str(caminho), 2048)


def test_arquivo_inexistente(tmp_path):
    with pytest.raises(ErroImagem, match="não foi possível ler o arquivo"):
        decodificar(str(tmp_path / "nao-existe.jpg"), 2048)
