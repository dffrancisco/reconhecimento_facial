# Fase 2 — vision-service: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serviço Python que detecta rostos e gera embeddings. Tem o modo `gpu` (estação: `/detect` com micro-lote) e o modo `selfie-cpu` (VPS: `/embed-selfie`), além de `/health` e de um benchmark na RTX 4070.

**Architecture:** A imagem é uma só (`apps/vision-service`), com o runtime ONNX escolhido por build arg (`onnxruntime` ou `onnxruntime-gpu`). Os modelos `det_10g` (SCRFD) e `w600k_r50` (ArcFace) do pacote `buffalo_l` são baixados no build e carregados pelo `model_zoo` do insightface. A decodificação (libjpeg-turbo, já reduzida) roda numa thread pool. As imagens decodificadas entram num micro-lote `asyncio`, que manda cada lote para uma única thread de inferência: detecção imagem a imagem e reconhecimento em lote. As funções de decisão (fator de redução, orientação EXIF, filtros, validação da selfie) são puras e testadas sem modelo.

**Tech Stack:** Python 3.11 (`python:3.11-slim`), FastAPI 0.141, uvicorn 0.53, insightface 2.0 (só `model_zoo` e `face_align`), onnxruntime / onnxruntime-gpu 1.30 (CUDA 13), PyTurboJPEG 1.8.3 + libturbojpeg do Debian, Pillow 12 (EXIF), nvidia-ml-py 13, pytest 9, httpx.

**Spec:** [docs/superpowers/specs/2026-09-18-plataforma-fotos-design.md](../specs/2026-09-18-plataforma-fotos-design.md) — seção 6 inteira, e as seções 3 e 11 para os containers. Leia o spec junto com este plano.

## Global Constraints

- Python 3.11, imagem `python:3.11-slim`. Os testes rodam **dentro da imagem de teste** (`npm run test:vision`), não no Python do host.
- Versões fixas: `insightface==2.0`, `onnxruntime==1.30.0` (CPU) / `onnxruntime-gpu[cuda,cudnn]==1.30.0` (GPU), `PyTurboJPEG==1.8.3` (a 2.x exige libjpeg-turbo 3, que o Debian não tem), `fastapi==0.141.1`, `uvicorn==0.53.0`, `nvidia-ml-py==13.610.43`, `Pillow==12.3.0`, `pytest==9.1.1`, `httpx==0.28.1`.
- `onnxruntime` e `onnxruntime-gpu` nunca ficam instalados juntos: o insightface instala o de CPU e o Dockerfile o troca.
- Modelos: só `det_10g.onnx` e `w600k_r50.onnx` do `buffalo_l`, em `/modelos` (`VISION_MODELOS_DIR`).
- Nomes de variáveis, funções, mensagens e logs em português. Log pelo `logging`, com prefixo `[Vision]`. Nunca logar embedding nem conteúdo de imagem.
- Contrato HTTP exatamente como na seção 6 do spec. `/detect` responde `{"resultados": [...]}`, na mesma ordem de `caminhos`.
- Defaults da seção 6: `VISION_LOTE_MAX=16`, `VISION_LOTE_ESPERA_MS=20`, `VISION_DET_SIZE=1024`, `VISION_DECODE_MIN_LADO=2048`, `VISION_ROSTO_MIN_PX=40`, `VISION_DET_SCORE_MIN=0.5`, `SELFIE_DET_SCORE_MIN=0.6`, `SELFIE_ROSTO_MIN_PX=80`, `SELFIE_CONCORRENCIA` = núcleos − 1, `VISION_TENSORRT=false`. A selfie usa `det_size` 640.
- Defaults que o spec não fixa (decididos aqui): `VISION_DECODE_THREADS=8`, `SELFIE_NITIDEZ_MIN=30` (a variância do Laplaciano é medida num recorte do rosto normalizado para 112×112; foto nítida ≈ 210, desfoque forte ≈ 14), `VISION_PORTA=8000`, `VISION_RAIZES=/data`.
- O vision só lê arquivos dentro de `VISION_RAIZES`. Qualquer outro caminho é recusado.
- Comentários só para o porquê não óbvio.
- Todo commit termina com a linha `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Pré-requisito que depende do usuário

Na máquina de desenvolvimento, o Docker ainda **não enxerga a GPU**: falta o `nvidia-container-toolkit`, e instalá-lo exige `sudo`. As Tasks 1 a 6 rodam sem GPU. As Tasks 7 e 8 começam conferindo o toolkit. Se ele não estiver instalado, o executor para e pede ao usuário para rodar:

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Depois de reiniciar o Docker, o compose de dev precisa subir de novo (`docker compose -f docker-compose.dev.yml up -d`).

## Riscos registrados

- **Licença dos modelos:** o insightface declara que os modelos pré-treinados (`buffalo_l` incluído) são "for non-commercial research only". O código da biblioteca é MIT. A plataforma é comercial, então o usuário precisa decidir sobre isso antes do primeiro evento pago: licença comercial com a InsightFace ou outros modelos. O plano segue o spec (usa o `buffalo_l`) e deixa o risco anotado em `docs/benchmark-vision.md`.
- **Lote no detector:** o `det_10g` roda uma imagem por vez (seção 6, "Risco conhecido"). O benchmark da Task 8 mede quanto a detecção pesa. Re-exportar o modelo fica fora desta fase: se ela for o gargalo, o resultado vira recomendação no documento do benchmark.

## Fora desta fase

O cliente Node do vision (worker `processar-foto`, busca na VPS) fica para as fases 3 e 4. O TensorRT só ganha o caminho em código e a validação do provider: instalar as bibliotecas TensorRT na imagem fica para quando for ligado.

## Mapa de arquivos

```
apps/vision-service/
├── Dockerfile                 # estágios: modelos, base (ARG ORT), teste, final
├── requirements.txt           # runtime (sem onnxruntime)
├── requirements-dev.txt       # pytest, httpx
├── pyproject.toml             # config do pytest
├── benchmark.py               # Task 8
├── app/
│   ├── __init__.py
│   ├── config.py              # carregar_config (pura) + Config
│   ├── imagem.py              # escolher_fator, aplicar_orientacao, decodificar
│   ├── rostos.py              # Rosto, converter, filtrar, validar selfie, nitidez
│   ├── lote.py                # MicroLote (asyncio + 1 thread de inferência)
│   ├── motor.py               # carregar_motor, conferir_providers, Motor
│   ├── gpu.py                 # ler_gpu (pynvml)
│   └── main.py                # criar_app (FastAPI) + main()
└── tests/
    ├── __init__.py
    ├── auxiliares.py          # config de teste, fixtures de imagem
    ├── conftest.py
    ├── test_config.py  test_imagem.py  test_rostos.py  test_lote.py
    ├── test_motor.py          # providers, com modelo falso
    ├── test_motor_modelos.py  # modelos reais em CPU (marker "modelos")
    └── test_main.py
docker-compose.dev.yml / .estacao.yml / .vps.yml   # serviços vision (Task 7)
docs/benchmark-vision.md                           # Task 8
```

---

### Task 1: Esqueleto, imagem de teste e configuração

**Files:**
- Create: `apps/vision-service/Dockerfile`, `requirements.txt`, `requirements-dev.txt`, `pyproject.toml`, `app/__init__.py`, `app/config.py`, `tests/__init__.py`, `tests/test_config.py`
- Modify: `package.json` (raiz) — script `test:vision`; `.gitignore` — caches do Python e `dados/`

**Interfaces:**
- Produces:
  - `class ErroConfig(Exception)`
  - `@dataclass(frozen=True) class Config` com os campos `modo: str`, `porta: int`, `modelos_dir: str`, `raizes: tuple[str, ...]`, `tensorrt: bool`, `tensorrt_cache: str`, `decode_threads: int`, `decode_min_lado: int`, `lote_max: int`, `lote_espera_ms: int`, `det_size: int`, `rosto_min_px: int`, `det_score_min: float`, `selfie_concorrencia: int`, `selfie_det_score_min: float`, `selfie_rosto_min_px: int`, `selfie_nitidez_min: float`
  - `carregar_config(env: Mapping[str, str]) -> Config`
  - Comando de teste: `npm run test:vision` (build do estágio `teste` e `pytest` dentro dele)

- [ ] **Step 1: Arquivos do pacote**

`apps/vision-service/requirements.txt`:

```
insightface==2.0
PyTurboJPEG==1.8.3
fastapi==0.141.1
uvicorn==0.53.0
nvidia-ml-py==13.610.43
Pillow==12.3.0
```

`apps/vision-service/requirements-dev.txt`:

```
pytest==9.1.1
httpx==0.28.1
```

`apps/vision-service/pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
markers = [
    "modelos: usa os modelos buffalo_l reais (roda em CPU na imagem de teste)",
]
```

`apps/vision-service/app/__init__.py` e `apps/vision-service/tests/__init__.py`: arquivos vazios.

`apps/vision-service/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM python:3.11-slim AS modelos
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Do buffalo_l só entram a detecção (SCRFD 10G) e o reconhecimento (ArcFace R50).
RUN curl -fsSL -o /tmp/buffalo_l.zip https://github.com/deepinsight/insightface/releases/download/model-zoo/buffalo_l.zip \
    && mkdir -p /modelos \
    && unzip -j /tmp/buffalo_l.zip '*det_10g.onnx' '*w600k_r50.onnx' -d /modelos \
    && rm /tmp/buffalo_l.zip

FROM python:3.11-slim AS base
ARG ORT=onnxruntime==1.30.0
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VISION_MODELOS_DIR=/modelos
RUN apt-get update \
    && apt-get install -y --no-install-recommends libturbojpeg0 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
# O insightface puxa o onnxruntime de CPU; a variante escolhida o substitui (os dois não podem coexistir).
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y onnxruntime \
    && pip install --no-cache-dir "$ORT"
COPY --from=modelos /modelos /modelos
COPY app app

FROM base AS teste
COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY pyproject.toml .
COPY tests tests
CMD ["python", "-m", "pytest", "-q", "-rs"]

FROM base AS final
RUN useradd --create-home --uid 1000 vision
USER vision
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status == 200 else 1)"
CMD ["python", "-m", "app.main"]
```

No `package.json` da raiz, acrescente em `scripts`:

```json
        "test:vision": "docker build -q -f apps/vision-service/Dockerfile --target teste -t fotos-vision:teste apps/vision-service && docker run --rm fotos-vision:teste"
```

No `.gitignore` da raiz, acrescente:

```
__pycache__/
.pytest_cache/
dados/
```

- [ ] **Step 2: Escrever o teste da configuração**

`apps/vision-service/tests/test_config.py`:

```python
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test:vision`
Expected: o build baixa os modelos e instala as dependências (a primeira vez demora alguns minutos); o pytest falha com `ModuleNotFoundError: No module named 'app.config'`.

- [ ] **Step 4: Implementar**

`apps/vision-service/app/config.py`:

```python
import os
from collections.abc import Mapping
from dataclasses import dataclass

MODOS = ("gpu", "selfie-cpu")


class ErroConfig(Exception):
    pass


@dataclass(frozen=True)
class Config:
    modo: str
    porta: int
    modelos_dir: str
    raizes: tuple[str, ...]
    tensorrt: bool
    tensorrt_cache: str
    decode_threads: int
    decode_min_lado: int
    lote_max: int
    lote_espera_ms: int
    det_size: int
    rosto_min_px: int
    det_score_min: float
    selfie_concorrencia: int
    selfie_det_score_min: float
    selfie_rosto_min_px: int
    selfie_nitidez_min: float


def _inteiro(env: Mapping[str, str], nome: str, padrao: int) -> int:
    valor = env.get(nome)
    if valor in (None, ""):
        return padrao
    try:
        numero = int(valor)
    except ValueError:
        numero = 0
    if numero <= 0:
        raise ErroConfig(f"{nome} deve ser um número inteiro positivo (recebido: {valor!r})")
    return numero


def _real(env: Mapping[str, str], nome: str, padrao: float) -> float:
    valor = env.get(nome)
    if valor in (None, ""):
        return padrao
    try:
        numero = float(valor)
    except ValueError:
        numero = -1.0
    if numero < 0:
        raise ErroConfig(f"{nome} deve ser um número >= 0 (recebido: {valor!r})")
    return numero


def _booleano(env: Mapping[str, str], nome: str) -> bool:
    valor = (env.get(nome) or "false").lower()
    if valor not in ("true", "false"):
        raise ErroConfig(f'{nome} deve ser "true" ou "false" (recebido: {valor!r})')
    return valor == "true"


def carregar_config(env: Mapping[str, str]) -> Config:
    modo = env.get("VISION_MODO", "")
    if modo not in MODOS:
        raise ErroConfig(f'VISION_MODO deve ser "gpu" ou "selfie-cpu" (recebido: "{modo}")')

    det_size = _inteiro(env, "VISION_DET_SIZE", 1024)
    # O SCRFD trabalha com strides 8/16/32: outro tamanho quebra a grade de âncoras.
    if det_size % 32:
        raise ErroConfig(f"VISION_DET_SIZE deve ser múltiplo de 32 (recebido: {det_size})")

    return Config(
        modo=modo,
        porta=_inteiro(env, "VISION_PORTA", 8000),
        modelos_dir=env.get("VISION_MODELOS_DIR") or "/modelos",
        raizes=tuple(r for r in (env.get("VISION_RAIZES") or "/data").split(":") if r),
        tensorrt=_booleano(env, "VISION_TENSORRT"),
        tensorrt_cache=env.get("VISION_TENSORRT_CACHE") or "/cache/tensorrt",
        decode_threads=_inteiro(env, "VISION_DECODE_THREADS", 8),
        decode_min_lado=_inteiro(env, "VISION_DECODE_MIN_LADO", 2048),
        lote_max=_inteiro(env, "VISION_LOTE_MAX", 16),
        lote_espera_ms=_inteiro(env, "VISION_LOTE_ESPERA_MS", 20),
        det_size=det_size,
        rosto_min_px=_inteiro(env, "VISION_ROSTO_MIN_PX", 40),
        det_score_min=_real(env, "VISION_DET_SCORE_MIN", 0.5),
        selfie_concorrencia=_inteiro(env, "SELFIE_CONCORRENCIA", max(1, (os.cpu_count() or 2) - 1)),
        selfie_det_score_min=_real(env, "SELFIE_DET_SCORE_MIN", 0.6),
        selfie_rosto_min_px=_inteiro(env, "SELFIE_ROSTO_MIN_PX", 80),
        selfie_nitidez_min=_real(env, "SELFIE_NITIDEZ_MIN", 30.0),
    )
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:vision`
Expected: `11 passed`, sem skipped.

- [ ] **Step 6: Commit**

```bash
git add apps/vision-service package.json .gitignore
git commit -m "feat(vision): esqueleto do serviço, imagem de teste e configuração" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Decodificação JPEG com redução e rotação EXIF

**Files:**
- Create: `apps/vision-service/app/imagem.py`
- Test: `apps/vision-service/tests/test_imagem.py`

**Interfaces:**
- Produces:
  - `class ErroImagem(Exception)`
  - `@dataclass class ImagemDecodificada: pixels: np.ndarray` (BGR, contíguo, já na orientação correta), `largura: int`, `altura: int` (resolução original, **depois** da rotação), `escala: float` (largura decodificada ÷ largura original)
  - `escolher_fator(largura: int, altura: int, min_lado: int, fatores) -> tuple[int, int]`
  - `aplicar_orientacao(pixels: np.ndarray, orientacao: int) -> np.ndarray`
  - `decodificar(caminho: str, min_lado: int | None) -> ImagemDecodificada` — com `min_lado=None` decodifica em tamanho cheio

- [ ] **Step 1: Escrever o teste**

`apps/vision-service/tests/test_imagem.py`:

```python
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:vision`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.imagem'`.

- [ ] **Step 3: Implementar**

`apps/vision-service/app/imagem.py`:

```python
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
    except Exception:
        raise ErroImagem("arquivo não é um JPEG válido") from None

    orientacao = _orientacao(dados)
    pixels = aplicar_orientacao(pixels, orientacao)
    if orientacao in (5, 6, 7, 8):
        largura, altura = altura, largura

    return ImagemDecodificada(pixels=pixels, largura=largura, altura=altura, escala=pixels.shape[1] / largura)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:vision`
Expected: todos PASS (11 da Task 1 + 18 novos).

- [ ] **Step 5: Commit**

```bash
git add apps/vision-service/app/imagem.py apps/vision-service/tests/test_imagem.py
git commit -m "feat(vision): decodificação JPEG reduzida com rotação EXIF" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rostos — conversão de coordenadas, filtros e validação da selfie

**Files:**
- Create: `apps/vision-service/app/rostos.py`
- Test: `apps/vision-service/tests/test_rostos.py`

**Interfaces:**
- Consumes: nada das tasks anteriores (funções puras sobre `numpy`)
- Produces:
  - `@dataclass class Rosto: bbox: list[float]` (x1, y1, x2, y2 na resolução original), `kps: list[list[float]]` (5 pontos, resolução original), `det_score: float`, `area_px: int`, `kps_decodificado: np.ndarray` ((5, 2) na imagem decodificada, usado no alinhamento), `embedding: list[float] | None = None`
  - `converter_deteccoes(bboxes: np.ndarray, kpss: np.ndarray, escala: float) -> list[Rosto]` — `bboxes` (n, 5) com o score na última coluna, `kpss` (n, 5, 2), ambos na imagem decodificada
  - `filtrar_rostos(rostos, rosto_min_px: int, det_score_min: float) -> list[Rosto]` — descarta score abaixo do mínimo ou lado menor (min(largura, altura)) abaixo de `rosto_min_px`
  - `MENSAGENS_SELFIE: dict[str, str]` e `class ErroSelfie(Exception)` com `.codigo`
  - `escolher_rosto_selfie(rostos, det_score_min: float, rosto_min_px: int) -> Rosto` — lança `ErroSelfie` na ordem `sem_rosto`, `varios_rostos` (segundo rosto com área ≥ 40% do maior), `baixa_confianca`, `rosto_pequeno`
  - `nitidez(pixels: np.ndarray, bbox: list[float], escala: float) -> float` — variância do Laplaciano no recorte do rosto redimensionado para 112×112 (0.0 se o recorte for vazio)

- [ ] **Step 1: Escrever o teste**

`apps/vision-service/tests/test_rostos.py`:

```python
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:vision`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.rostos'`.

- [ ] **Step 3: Implementar**

`apps/vision-service/app/rostos.py`:

```python
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:vision`
Expected: todos PASS, sem skipped.

- [ ] **Step 5: Commit**

```bash
git add apps/vision-service/app/rostos.py apps/vision-service/tests/test_rostos.py
git commit -m "feat(vision): filtros de rosto e validação da selfie" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Micro-lote

**Files:**
- Create: `apps/vision-service/app/lote.py`
- Test: `apps/vision-service/tests/test_lote.py`

**Interfaces:**
- Produces:
  - `class MicroLote(processar: Callable[[list], list], lote_max: int, espera_s: float)` — `processar` recebe a lista de itens e devolve a lista de resultados, na mesma ordem. Roda numa thread dedicada.
  - `async iniciar() -> None`, `async parar() -> None`, `async enviar(item) -> resultado`, `tamanho_fila: int` (propriedade)
- Comportamento: o lote sai com `lote_max` itens ou depois de `espera_s` contados do primeiro item. Se `processar` lançar uma exceção, ela chega a todos os itens daquele lote. `enviar` antes de `iniciar` lança `RuntimeError`.

- [ ] **Step 1: Escrever o teste**

`apps/vision-service/tests/test_lote.py`:

```python
import asyncio
import time

import pytest

from app.lote import MicroLote


def rodar(corotina):
    return asyncio.run(corotina)


def test_agrupa_ate_o_tamanho_maximo():
    tamanhos = []

    def processar(itens):
        tamanhos.append(len(itens))
        return [i * 2 for i in itens]

    async def cenario():
        lote = MicroLote(processar, lote_max=16, espera_s=0.05)
        await lote.iniciar()
        resultados = await asyncio.gather(*(lote.enviar(i) for i in range(20)))
        await lote.parar()
        return resultados

    assert rodar(cenario()) == [i * 2 for i in range(20)]
    assert tamanhos == [16, 4]


def test_item_sozinho_sai_depois_da_espera():
    async def cenario():
        lote = MicroLote(lambda itens: itens, lote_max=16, espera_s=0.02)
        await lote.iniciar()
        inicio = time.perf_counter()
        resultado = await lote.enviar("a")
        decorrido = time.perf_counter() - inicio
        await lote.parar()
        return resultado, decorrido

    resultado, decorrido = rodar(cenario())
    assert resultado == "a"
    assert decorrido < 0.5


def test_erro_no_processamento_chega_a_todos_do_lote():
    def processar(itens):
        raise ValueError("falhou")

    async def cenario():
        lote = MicroLote(processar, lote_max=4, espera_s=0.05)
        await lote.iniciar()
        resultados = await asyncio.gather(*(lote.enviar(i) for i in range(3)), return_exceptions=True)
        await lote.parar()
        return resultados

    resultados = rodar(cenario())
    assert len(resultados) == 3
    assert all(isinstance(r, ValueError) for r in resultados)


def test_processamento_bloqueante_nao_trava_o_event_loop():
    def processar(itens):
        time.sleep(0.3)
        return itens

    async def cenario():
        lote = MicroLote(processar, lote_max=1, espera_s=0.001)
        await lote.iniciar()
        batidas = 0

        async def relogio():
            nonlocal batidas
            for _ in range(10):
                await asyncio.sleep(0.02)
                batidas += 1

        await asyncio.gather(lote.enviar(1), relogio())
        await lote.parar()
        return batidas

    assert rodar(cenario()) == 10


def test_continua_depois_de_um_erro():
    chamadas = []

    def processar(itens):
        chamadas.append(itens)
        if len(chamadas) == 1:
            raise RuntimeError("primeiro lote")
        return itens

    async def cenario():
        lote = MicroLote(processar, lote_max=1, espera_s=0.001)
        await lote.iniciar()
        with pytest.raises(RuntimeError):
            await lote.enviar("x")
        resultado = await lote.enviar("y")
        await lote.parar()
        return resultado

    assert rodar(cenario()) == "y"


def test_enviar_sem_iniciar():
    async def cenario():
        await MicroLote(lambda itens: itens, lote_max=1, espera_s=0.01).enviar(1)

    with pytest.raises(RuntimeError, match="não iniciado"):
        rodar(cenario())


def test_tamanho_da_fila():
    async def cenario():
        lote = MicroLote(lambda itens: itens, lote_max=1, espera_s=0.01)
        antes = lote.tamanho_fila
        await lote.iniciar()
        depois = lote.tamanho_fila
        await lote.parar()
        return antes, depois

    assert rodar(cenario()) == (0, 0)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:vision`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.lote'`.

- [ ] **Step 3: Implementar**

`apps/vision-service/app/lote.py`:

```python
import asyncio
import contextlib
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor


class MicroLote:
    def __init__(self, processar: Callable[[list], list], lote_max: int, espera_s: float):
        self._processar = processar
        self._lote_max = lote_max
        self._espera_s = espera_s
        self._fila: asyncio.Queue | None = None
        self._tarefa: asyncio.Task | None = None
        # Uma thread só: a GPU processa um lote por vez e o event loop segue livre para decodificar e receber.
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="inferencia")

    @property
    def tamanho_fila(self) -> int:
        return self._fila.qsize() if self._fila else 0

    async def iniciar(self) -> None:
        self._fila = asyncio.Queue()
        self._tarefa = asyncio.create_task(self._rodar())

    async def parar(self) -> None:
        if self._tarefa:
            self._tarefa.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._tarefa
        self._executor.shutdown(wait=False)

    async def enviar(self, item):
        if self._fila is None:
            raise RuntimeError("MicroLote não iniciado")
        futuro = asyncio.get_running_loop().create_future()
        await self._fila.put((item, futuro))
        return await futuro

    async def _juntar(self) -> list:
        loop = asyncio.get_running_loop()
        lote = [await self._fila.get()]
        limite = loop.time() + self._espera_s
        while len(lote) < self._lote_max:
            restante = limite - loop.time()
            if restante <= 0:
                break
            try:
                lote.append(await asyncio.wait_for(self._fila.get(), restante))
            except asyncio.TimeoutError:
                break
        return lote

    async def _rodar(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            lote = await self._juntar()
            itens = [item for item, _ in lote]
            try:
                resultados = await loop.run_in_executor(self._executor, self._processar, itens)
            except Exception as erro:
                for _, futuro in lote:
                    if not futuro.done():
                        futuro.set_exception(erro)
                continue
            for (_, futuro), resultado in zip(lote, resultados):
                if not futuro.done():
                    futuro.set_result(resultado)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:vision`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/vision-service/app/lote.py apps/vision-service/tests/test_lote.py
git commit -m "feat(vision): micro-lote asyncio com thread única de inferência" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Motor — modelos, providers, detecção em lote e embedding da selfie

**Files:**
- Create: `apps/vision-service/app/motor.py`, `apps/vision-service/tests/auxiliares.py`, `apps/vision-service/tests/conftest.py`
- Test: `apps/vision-service/tests/test_motor.py` (modelo falso), `apps/vision-service/tests/test_motor_modelos.py` (modelos reais em CPU)

**Interfaces:**
- Consumes: `Config`, `carregar_config` (Task 1); `ImagemDecodificada`, `decodificar` (Task 2); `Rosto`, `converter_deteccoes`, `filtrar_rostos`, `escolher_rosto_selfie`, `nitidez`, `ErroSelfie` (Task 3)
- Produces:
  - `class ErroInicializacao(Exception)`
  - `DETECTOR = "det_10g.onnx"`, `RECONHECEDOR = "w600k_r50.onnx"`, `SELFIE_DET_LIMIAR = 0.3`, `SELFIE_DET_SIZE = 640`
  - `providers_do_modo(config) -> tuple[list[str], list[dict]]`
  - `conferir_providers(nome: str, ativos: list[str], config) -> None` — lança `ErroInicializacao`
  - `carregar_motor(config, fabrica=get_model) -> Motor`
  - `class Motor(config, detector, reconhecedor, tamanho: int)` com `providers: dict[str, list[str]]`, `detectar_lote(imagens: list[ImagemDecodificada], tempos: dict | None = None) -> list[list[Rosto]]` (rostos filtrados e com `embedding` preenchido; `tempos`, se passado, acumula os segundos em `"deteccao"` e `"reconhecimento"`) e `embed_selfie(imagem: ImagemDecodificada) -> dict` (`{"embedding", "det_score", "largura_rosto", "nitidez"}`, ou lança `ErroSelfie`)
  - `tests/auxiliares.py`: `config_teste(**env) -> Config` (modo `selfie-cpu`, modelos em `VISION_MODELOS_DIR` ou `/modelos`) e `salvar_jpeg(caminho, pixels) -> str`

Detecção e alinhamento usam a imagem decodificada (reduzida). As coordenadas de saída estão na resolução original. O `embedding` é o vetor normalizado (norma 1), como o `normed_embedding` do insightface.

- [ ] **Step 1: Auxiliares e fixtures**

`apps/vision-service/tests/auxiliares.py`:

```python
import os

import cv2

from app.config import Config, carregar_config


def config_teste(**env) -> Config:
    base = {"VISION_MODO": "selfie-cpu", "VISION_MODELOS_DIR": os.environ.get("VISION_MODELOS_DIR", "/modelos")}
    base.update(env)
    return carregar_config(base)


def salvar_jpeg(caminho, pixels) -> str:
    ok, buffer = cv2.imencode(".jpg", pixels, [cv2.IMWRITE_JPEG_QUALITY, 95])
    assert ok
    caminho.write_bytes(buffer.tobytes())
    return str(caminho)
```

`apps/vision-service/tests/conftest.py`:

```python
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
```

- [ ] **Step 2: Escrever os testes**

`apps/vision-service/tests/test_motor.py` (sem modelos):

```python
import numpy as np
import pytest

from app.motor import DETECTOR, RECONHECEDOR, ErroInicializacao, carregar_motor, providers_do_modo
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

    def prepare(self, ctx_id, **kwargs):
        self.preparado = {"ctx_id": ctx_id, **kwargs}


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


def test_detectar_lote_vazio_nao_chama_o_reconhecedor(modelos_vazios):
    motor = carregar_motor(config_teste(VISION_MODELOS_DIR=modelos_vazios), fabrica=fabrica_com(["CPUExecutionProvider"]))

    def detect(pixels, input_size):
        return np.zeros((0, 5), np.float32), np.zeros((0, 5, 2), np.float32)

    motor.detector.detect = detect
    motor.reconhecedor.get_feat = lambda crops: pytest.fail("não deveria reconhecer sem rostos")

    from app.imagem import ImagemDecodificada

    assert motor.detectar_lote([ImagemDecodificada(np.zeros((10, 10, 3), np.uint8), 10, 10, 1.0)]) == [[]]
```

`apps/vision-service/tests/test_motor_modelos.py` (modelos reais, CPU):

```python
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test:vision`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.motor'`.

- [ ] **Step 4: Implementar**

`apps/vision-service/app/motor.py`:

```python
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
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:vision`
Expected: todos PASS, **nenhum skipped** (o `-rs` lista os skips; se aparecer "modelos buffalo_l ausentes", o estágio `modelos` do Dockerfile não copiou os arquivos). O teste com modelo falso passa `prepare(ctx_id, ...)` posicional; se o `SCRFD.prepare` do insightface 2.0 recusar `input_size` ou `det_thresh`, ajuste a chamada e o teste juntos e registre no relatório.

- [ ] **Step 6: Commit**

```bash
git add apps/vision-service/app/motor.py apps/vision-service/tests
git commit -m "feat(vision): motor com conferência de providers, detecção em lote e selfie" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: API FastAPI, `/health` e entrada do processo

**Files:**
- Create: `apps/vision-service/app/gpu.py`, `apps/vision-service/app/main.py`
- Test: `apps/vision-service/tests/test_main.py`

**Interfaces:**
- Consumes: `Config`, `carregar_config`, `ErroConfig` (Task 1); `decodificar`, `ErroImagem` (Task 2); `ErroSelfie` (Task 3); `MicroLote` (Task 4); `carregar_motor`, `ErroInicializacao`, `Motor` (Task 5)
- Produces:
  - `ler_gpu() -> dict | None` — `{"vram_usada_mb", "vram_total_mb", "utilizacao"}` da GPU 0, ou `None` se não houver NVML
  - `caminho_permitido(caminho: str, raizes: tuple[str, ...]) -> bool`
  - `criar_app(config, motor, gpu_info=ler_gpu) -> FastAPI`
  - `main()` — lê o ambiente, carrega o motor e sobe o uvicorn com 1 worker. Se a configuração ou os providers falharem, loga `[Vision] <motivo>` e sai com código 1.
- Contrato HTTP:
  - `GET /health` → `{"modo", "modelo": "buffalo_l", "providers": {"detector": [...], "reconhecedor": [...]}, "gpu": {...} | null, "fila": int}`
  - Só no modo `gpu`: `POST /detect {"caminhos": [1..64]}` → `{"resultados": [{"caminho", "largura", "altura", "rostos": [{"embedding", "bbox", "det_score", "kps", "area_px"}]} | {"caminho", "erro", "rostos": []}]}`
  - Só no modo `selfie-cpu`: `POST /embed-selfie {"caminho"}` → 200 `{"embedding", "det_score", "largura_rosto", "nitidez"}` ou 422 `{"codigo", "msg"}`. Os códigos são os da Task 3, mais `arquivo_invalido` e `caminho_invalido`.

- [ ] **Step 1: Escrever o teste**

`apps/vision-service/tests/test_main.py`:

```python
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:vision`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 3: Implementar**

`apps/vision-service/app/gpu.py`:

```python
import logging

log = logging.getLogger("vision")

_estado = {"iniciado": False, "avisado": False}


def ler_gpu() -> dict | None:
    try:
        import pynvml

        if not _estado["iniciado"]:
            pynvml.nvmlInit()
            _estado["iniciado"] = True
        dispositivo = pynvml.nvmlDeviceGetHandleByIndex(0)
        memoria = pynvml.nvmlDeviceGetMemoryInfo(dispositivo)
        uso = pynvml.nvmlDeviceGetUtilizationRates(dispositivo)
        return {
            "vram_usada_mb": int(memoria.used // 2**20),
            "vram_total_mb": int(memoria.total // 2**20),
            "utilizacao": int(uso.gpu),
        }
    except Exception as erro:
        if not _estado["avisado"]:
            log.warning("[Vision] NVML indisponível: %s", erro)
            _estado["avisado"] = True
        return None
```

`apps/vision-service/app/main.py`:

```python
import asyncio
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.config import Config, ErroConfig, carregar_config
from app.gpu import ler_gpu
from app.imagem import ErroImagem, decodificar
from app.lote import MicroLote
from app.motor import ErroInicializacao, carregar_motor
from app.rostos import ErroSelfie, Rosto

log = logging.getLogger("vision")

MENSAGEM_ARQUIVO_INVALIDO = "Não conseguimos abrir a foto. Tente outra."


class EntradaDetectar(BaseModel):
    caminhos: list[str] = Field(min_length=1, max_length=64)


class EntradaSelfie(BaseModel):
    caminho: str


def caminho_permitido(caminho: str, raizes: tuple[str, ...]) -> bool:
    real = os.path.realpath(caminho)
    for raiz in raizes:
        base = os.path.realpath(raiz)
        if real == base or real.startswith(base.rstrip("/") + "/"):
            return True
    return False


def _rosto_json(rosto: Rosto) -> dict:
    return {
        "embedding": rosto.embedding,
        "bbox": rosto.bbox,
        "det_score": rosto.det_score,
        "kps": rosto.kps,
        "area_px": rosto.area_px,
    }


def _recusa_selfie(codigo: str, msg: str) -> JSONResponse:
    return JSONResponse(status_code=422, content={"codigo": codigo, "msg": msg})


def criar_app(config: Config, motor, gpu_info=ler_gpu) -> FastAPI:
    gpu = config.modo == "gpu"
    decode_pool = ThreadPoolExecutor(config.decode_threads, thread_name_prefix="decode")
    lote = MicroLote(motor.detectar_lote, config.lote_max, config.lote_espera_ms / 1000) if gpu else None
    semaforo = asyncio.Semaphore(config.selfie_concorrencia)

    @asynccontextmanager
    async def ciclo(_app: FastAPI):
        if lote:
            await lote.iniciar()
        yield
        if lote:
            await lote.parar()
        decode_pool.shutdown(wait=False)

    app = FastAPI(title="vision-service", lifespan=ciclo)

    @app.get("/health")
    def health():
        return {
            "modo": config.modo,
            "modelo": "buffalo_l",
            "providers": motor.providers,
            "gpu": gpu_info() if gpu else None,
            "fila": lote.tamanho_fila if lote else 0,
        }

    if gpu:

        @app.post("/detect")
        async def detect(entrada: EntradaDetectar):
            loop = asyncio.get_running_loop()

            async def uma(caminho: str) -> dict:
                if not caminho_permitido(caminho, config.raizes):
                    return {"caminho": caminho, "erro": "caminho fora da área permitida", "rostos": []}
                try:
                    imagem = await loop.run_in_executor(decode_pool, decodificar, caminho, config.decode_min_lado)
                except ErroImagem as erro:
                    return {"caminho": caminho, "erro": str(erro), "rostos": []}
                rostos = await lote.enviar(imagem)
                return {
                    "caminho": caminho,
                    "largura": imagem.largura,
                    "altura": imagem.altura,
                    "rostos": [_rosto_json(r) for r in rostos],
                }

            return {"resultados": await asyncio.gather(*(uma(c) for c in entrada.caminhos))}

    else:

        def processar_selfie(caminho: str) -> dict:
            return motor.embed_selfie(decodificar(caminho, None))

        @app.post("/embed-selfie")
        async def embed_selfie(entrada: EntradaSelfie):
            if not caminho_permitido(entrada.caminho, config.raizes):
                return _recusa_selfie("caminho_invalido", MENSAGEM_ARQUIVO_INVALIDO)
            async with semaforo:
                try:
                    return await asyncio.get_running_loop().run_in_executor(None, processar_selfie, entrada.caminho)
                except ErroSelfie as erro:
                    return _recusa_selfie(erro.codigo, str(erro))
                except ErroImagem:
                    return _recusa_selfie("arquivo_invalido", MENSAGEM_ARQUIVO_INVALIDO)

    return app


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        config = carregar_config(os.environ)
        motor = carregar_motor(config)
    except (ErroConfig, ErroInicializacao) as erro:
        log.error("[Vision] %s", erro)
        sys.exit(1)

    # Um processo por GPU: vários workers disputariam a mesma VRAM.
    uvicorn.run(criar_app(config, motor), host="0.0.0.0", port=config.porta, workers=1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:vision`
Expected: todos PASS, nenhum skipped.

- [ ] **Step 5: Commit**

```bash
git add apps/vision-service/app/gpu.py apps/vision-service/app/main.py apps/vision-service/tests/test_main.py
git commit -m "feat(vision): API /detect, /embed-selfie e /health por modo" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Imagem GPU, composes e verificação na RTX 4070

**Files:**
- Modify: `docker-compose.dev.yml` — serviços `vision-gpu` (perfil `gpu`) e `vision-cpu`, volume `selfies` em tmpfs, que o `api-vps` também monta
- Modify: `docker-compose.estacao.yml` — serviço `vision` (GPU) com os volumes `originais` e `cache-tensorrt`
- Modify: `docker-compose.vps.yml` — serviço `vision` (`selfie-cpu`) e volume `selfies` em tmpfs, compartilhado com a `api`
- Modify: `.env.vps.example` — `SELFIE_CONCORRENCIA` comentado

**Interfaces:**
- Consumes: a imagem da Task 1 (estágio `final`, ARG `ORT`) e `main()` da Task 6
- Produces:
  - dev: vision GPU em `127.0.0.1:8001`, vision CPU em `127.0.0.1:8002`;
  - estação: `http://vision:8000` visto do worker, que chega na fase 3;
  - VPS: `http://vision:8000` visto da API;
  - selfies em `/data/selfies`, dentro do volume tmpfs `selfies`, montado na API e no vision.

- [ ] **Step 1: Conferir o nvidia-container-toolkit**

Run: `docker run --rm --gpus all python:3.11-slim nvidia-smi --query-gpu=name --format=csv,noheader`
Expected: `NVIDIA GeForce RTX 4070`. Se o comando falhar com `could not select device driver "" with capabilities: [[gpu]]`, **pare** e reporte BLOCKED com os comandos da seção "Pré-requisito que depende do usuário" deste plano.

- [ ] **Step 2: Compose de desenvolvimento**

Em `docker-compose.dev.yml`, acrescente em `services:`:

```yaml
  vision-gpu:
    profiles: ["gpu"]
    build:
      context: ./apps/vision-service
      target: final
      args:
        ORT: onnxruntime-gpu[cuda,cudnn]==1.30.0
    environment:
      VISION_MODO: gpu
    volumes:
      - ./dados:/data/dados:ro
    ports:
      - "127.0.0.1:8001:8000"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  vision-cpu:
    build:
      context: ./apps/vision-service
      target: final
    environment:
      VISION_MODO: selfie-cpu
      VISION_RAIZES: /data/selfies
    volumes:
      - selfies:/data/selfies
    ports:
      - "127.0.0.1:8002:8000"
```

No serviço `api-vps`, acrescente:

```yaml
    volumes:
      - selfies:/data/selfies
```

Em `volumes:` (raiz do arquivo), acrescente:

```yaml
  # Selfies só existem durante a busca (spec §10): tmpfs, nunca em disco.
  selfies:
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: "size=256m,uid=1000"
```

Atualize o comentário do topo:

```yaml
# Desenvolvimento: os dois papéis na mesma máquina.
# Só a infraestrutura:  docker compose -f docker-compose.dev.yml up -d postgres redis
# Tudo (sem GPU):       docker compose -f docker-compose.dev.yml up -d --build
# Com o vision na GPU:  docker compose -f docker-compose.dev.yml --profile gpu up -d --build
```

- [ ] **Step 3: Composes da estação e da VPS**

Em `docker-compose.estacao.yml`, acrescente em `services:`:

```yaml
  vision:
    build:
      context: ./apps/vision-service
      target: final
      args:
        ORT: onnxruntime-gpu[cuda,cudnn]==1.30.0
    environment:
      VISION_MODO: gpu
      VISION_RAIZES: /data/originais
    volumes:
      - originais:/data/originais:ro
      - cache-tensorrt:/cache/tensorrt
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped
```

e em `volumes:`:

```yaml
  originais:
  cache-tensorrt:
```

Em `docker-compose.vps.yml`, acrescente em `services:`:

```yaml
  vision:
    build:
      context: ./apps/vision-service
      target: final
    environment:
      VISION_MODO: selfie-cpu
      VISION_RAIZES: /data/selfies
      SELFIE_CONCORRENCIA: ${SELFIE_CONCORRENCIA:-}
    volumes:
      - selfies:/data/selfies
    restart: unless-stopped
```

No serviço `api` da VPS, acrescente:

```yaml
    volumes:
      - selfies:/data/selfies
```

e em `volumes:`:

```yaml
  # Selfies só existem durante a busca (spec §10): tmpfs, nunca em disco.
  selfies:
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: "size=256m,uid=1000"
```

Em `.env.vps.example`, acrescente no fim:

```
# Selfies processadas ao mesmo tempo no vision (CPU). Vazio = núcleos - 1.
SELFIE_CONCORRENCIA=
```

- [ ] **Step 4: Subir e verificar na GPU**

Run:

```bash
mkdir -p dados
docker compose -f docker-compose.dev.yml --profile gpu up -d --build vision-gpu vision-cpu
docker compose -f docker-compose.dev.yml --profile gpu ps vision-gpu vision-cpu
docker compose -f docker-compose.dev.yml run --rm --no-deps -v "$PWD/dados:/saida" vision-cpu \
    python -c "import cv2; from insightface.data import get_image; cv2.imwrite('/saida/t1.jpg', get_image('t1'))"
curl -s localhost:8001/health; echo
curl -s localhost:8002/health; echo
curl -s -X POST localhost:8001/detect -H 'Content-Type: application/json' \
    -d '{"caminhos":["/data/dados/t1.jpg","/data/dados/nao-existe.jpg"]}' \
    | python3 -c "import sys,json; r=json.load(sys.stdin)['resultados']; print(len(r[0]['rostos']), r[1]['erro'])"
```

Expected:
- os dois serviços `healthy`;
- o `/health` da 8001 tem `CUDAExecutionProvider` nos dois providers e `gpu.vram_total_mb` perto de 12282;
- o `/health` da 8002 tem só `CPUExecutionProvider` e `"gpu":null`;
- o `/detect` imprime `6 não foi possível ler o arquivo: No such file or directory`.

- [ ] **Step 5: Falha na inicialização sem GPU**

Run:

```bash
docker run --rm -e VISION_MODO=gpu "$(docker compose -f docker-compose.dev.yml --profile gpu images -q vision-gpu)"; echo "saida=$?"
```

Expected: o log mostra `[Vision] detector: VISION_MODO=gpu exige CUDAExecutionProvider, mas a sessão ONNX ficou com ['CPUExecutionProvider']...` e `saida=1` (sem `--gpus`, o container não vê a GPU).

- [ ] **Step 6: Validar os composes da estação e da VPS**

Run:

```bash
cp .env.estacao.example .env.estacao && cp .env.vps.example .env.vps
docker compose --env-file .env.estacao -f docker-compose.estacao.yml config -q && echo estacao-ok
docker compose --env-file .env.vps -f docker-compose.vps.yml config -q && echo vps-ok
rm .env.estacao .env.vps
```

Expected: `estacao-ok` e `vps-ok`. Subir os dois de verdade fica para o checklist de deploy da fase 7, que depende dos domínios.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.dev.yml docker-compose.estacao.yml docker-compose.vps.yml .env.vps.example
git commit -m "feat(infra): vision nos composes, com GPU na estação e selfie em tmpfs na VPS" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Benchmark na RTX 4070 e documentação

**Files:**
- Create: `apps/vision-service/benchmark.py`, `docs/benchmark-vision.md`
- Modify: `apps/vision-service/Dockerfile` (estágio `final` copia o `benchmark.py`), `docs/desenvolvimento.md` (seção do vision)

**Interfaces:**
- Consumes: `carregar_config` (Task 1), `decodificar` (Task 2), `carregar_motor` e `Motor.detectar_lote(imagens, tempos)` (Task 5), `ler_gpu` (Task 6)
- Produces: `python benchmark.py --pasta <dir> [--limite N] [--lotes 1,8,16] [--det-sizes 640,1024]`, que imprime uma tabela Markdown com fotos/s, ms por foto em cada etapa (decodificação, detecção, reconhecimento), rostos por foto e pico de VRAM.

- [ ] **Step 1: Script do benchmark**

`apps/vision-service/benchmark.py`:

```python
"""Vazão do vision na GPU, por tamanho de lote e det_size.

Uso (dentro do container vision-gpu):
    python benchmark.py --pasta /data/dados/fotos-benchmark --limite 300
"""

import argparse
import dataclasses
import glob
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from app.config import carregar_config
from app.gpu import ler_gpu
from app.imagem import decodificar
from app.motor import carregar_motor


class PicoVram:
    def __init__(self):
        self.pico = 0
        self._parar = threading.Event()
        self._thread = threading.Thread(target=self._amostrar, daemon=True)

    def _amostrar(self):
        while not self._parar.wait(0.1):
            gpu = ler_gpu()
            if gpu:
                self.pico = max(self.pico, gpu["vram_usada_mb"])

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *_):
        self._parar.set()
        self._thread.join()


def medir(motor, caminhos, lote, config):
    tempos = {"deteccao": 0.0, "reconhecimento": 0.0}
    decodificacao = []

    def decodificar_medindo(caminho):
        inicio = time.perf_counter()
        imagem = decodificar(caminho, config.decode_min_lado)
        decodificacao.append(time.perf_counter() - inicio)
        return imagem

    rostos = 0
    inicio = time.perf_counter()
    with ThreadPoolExecutor(config.decode_threads) as pool:
        # O map decodifica à frente enquanto a GPU processa o lote atual, como no serviço.
        imagens = pool.map(decodificar_medindo, caminhos)
        pendentes = []
        for imagem in imagens:
            pendentes.append(imagem)
            if len(pendentes) == lote:
                rostos += sum(len(r) for r in motor.detectar_lote(pendentes, tempos))
                pendentes = []
        if pendentes:
            rostos += sum(len(r) for r in motor.detectar_lote(pendentes, tempos))
    total = time.perf_counter() - inicio

    n = len(caminhos)
    return {
        "fotos_s": n / total,
        "decode_ms": 1000 * sum(decodificacao) / n,
        "deteccao_ms": 1000 * tempos["deteccao"] / n,
        "reconhecimento_ms": 1000 * tempos["reconhecimento"] / n,
        "rostos_por_foto": rostos / n,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pasta", required=True)
    parser.add_argument("--limite", type=int, default=300)
    parser.add_argument("--lotes", default="1,8,16")
    parser.add_argument("--det-sizes", default="640,1024")
    args = parser.parse_args()

    caminhos = sorted(glob.glob(os.path.join(args.pasta, "*.jp*g")) + glob.glob(os.path.join(args.pasta, "*.JP*G")))
    caminhos = caminhos[: args.limite]
    if not caminhos:
        raise SystemExit(f"Nenhum JPEG em {args.pasta}")

    base = carregar_config({**os.environ, "VISION_MODO": "gpu"})
    print(f"{len(caminhos)} fotos de {args.pasta}\n")
    print("| det_size | lote | fotos/s | decodificação ms/foto | detecção ms/foto | reconhecimento ms/foto | rostos/foto | pico VRAM MB |")
    print("|---|---|---|---|---|---|---|---|")
    for det_size in (int(v) for v in args.det_sizes.split(",")):
        config = dataclasses.replace(base, det_size=det_size)
        motor = carregar_motor(config)
        medir(motor, caminhos[:5], 1, config)  # aquecimento: cria as sessões e aloca a VRAM
        for lote in (int(v) for v in args.lotes.split(",")):
            with PicoVram() as vram:
                r = medir(motor, caminhos, lote, config)
            print(
                f"| {det_size} | {lote} | {r['fotos_s']:.1f} | {r['decode_ms']:.1f} | {r['deteccao_ms']:.1f} | "
                f"{r['reconhecimento_ms']:.1f} | {r['rostos_por_foto']:.1f} | {vram.pico} |"
            )


if __name__ == "__main__":
    main()
```

No `Dockerfile`, no estágio `final`, acrescente antes do `RUN useradd`:

```dockerfile
COPY benchmark.py .
```

- [ ] **Step 2: Fotos do benchmark**

O ideal são fotos reais de evento (JPEG de 20–24 MP) em `dados/fotos-benchmark/`, com pelo menos 200 arquivos. Se o usuário não tiver fornecido fotos, gere 200 sintéticas a partir da `t1` ampliada (6 rostos, 6000×4153) e registre no documento que o número é sintético:

```bash
mkdir -p dados/fotos-benchmark
docker compose -f docker-compose.dev.yml run --rm --no-deps -v "$PWD/dados:/saida" vision-cpu python -c "
import cv2
from insightface.data import get_image
base = cv2.resize(get_image('t1'), (6000, 4153), interpolation=cv2.INTER_CUBIC)
for i in range(200):
    cv2.imwrite(f'/saida/fotos-benchmark/sintetica_{i:03d}.jpg', cv2.flip(base, i % 2), [cv2.IMWRITE_JPEG_QUALITY, 92])
"
```

- [ ] **Step 3: Rodar na 4070**

Run:

```bash
docker compose -f docker-compose.dev.yml --profile gpu up -d --build vision-gpu
docker compose -f docker-compose.dev.yml --profile gpu exec vision-gpu python benchmark.py --pasta /data/dados/fotos-benchmark --limite 200
```

Expected: a tabela com 6 linhas (det_size 640 e 1024 × lotes 1, 8 e 16), sem erro. Guarde a saída.

- [ ] **Step 4: Documento do benchmark**

Crie `docs/benchmark-vision.md` com:
- data, GPU (RTX 4070, 12 GB), driver, versões (onnxruntime-gpu 1.30.0, insightface 2.0), e se as fotos são reais ou sintéticas;
- a tabela exatamente como o script imprimiu;
- **Conclusão**, em três pontos:
  1. a vazão com os padrões (det_size 1024, lote 16) em fotos/min, comparada com a meta do spec (20.000 fotos em 2 dias, p95 < 10 min do upload à publicação);
  2. qual etapa pesa mais. Se a detecção for mais da metade do tempo, a recomendação é re-exportar o `det_10g` com lote dinâmico (risco da seção 6 do spec). Se for a decodificação, aumentar `VISION_DECODE_THREADS`;
  3. o pico de VRAM contra os 12 GB.
- **Riscos**:
  - a licença dos modelos `buffalo_l` é "non-commercial research only", o que exige decisão antes do primeiro evento pago;
  - a diferença de embeddings entre a GPU (estação) e a CPU (VPS) é absorvida pela calibração da fase 4.

Em `docs/desenvolvimento.md`, acrescente a seção:

````markdown
## vision-service (Python)

```bash
npm run test:vision                                                   # testes, em CPU, dentro da imagem de teste
docker compose -f docker-compose.dev.yml --profile gpu up -d --build  # sobe o vision-gpu (8001) e o vision-cpu (8002)
curl -s localhost:8001/health
```

O vision na GPU precisa do `nvidia-container-toolkit` no host. A pasta `dados/` (fora do git) aparece dentro do `vision-gpu` como `/data/dados`, para testes manuais e para o benchmark (`docs/benchmark-vision.md`).
````

- [ ] **Step 5: Verificação final**

Run:

```bash
npm run test:vision
npm run typecheck && npm test
git status --short
```

Expected: `npm run test:vision` com todos PASS e nenhum skipped; os testes Node seguem verdes; `git status` não mostra `dados/`.

- [ ] **Step 6: Commit**

```bash
git add apps/vision-service/benchmark.py apps/vision-service/Dockerfile docs/benchmark-vision.md docs/desenvolvimento.md
git commit -m "feat(vision): benchmark na RTX 4070 e documentação" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Cobertura do spec (fase 2 e seção 6)

| Item do spec | Task |
|---|---|
| Modos `gpu` e `selfie-cpu`; na GPU, conferir o provider e encerrar com erro | 5, 6, 7 |
| `selfie-cpu` com CPU explícito, só `/embed-selfie` e `/health`, semáforo `SELFIE_CONCORRENCIA` | 5, 6 |
| `/detect`: embedding normalizado, coordenadas na resolução original depois do EXIF, erro por imagem | 2, 3, 5, 6 |
| `/embed-selfie`: 5 códigos de recusa com mensagem em português, `det_size` 640 | 3, 5, 6 |
| `/health`: modo, providers, modelo, VRAM e utilização, fila | 6 |
| Decodificação com libjpeg-turbo reduzida em thread pool, sobreposta à inferência | 2, 6 |
| Micro-lote (`LOTE_MAX` 16, `ESPERA_MS` 20) com future por requisição | 4, 6 |
| Filtros de tamanho (40 px, na resolução original) e de score (0.5) | 3, 5 |
| Reconhecimento em lote com os recortes de todo o micro-lote | 5 |
| TensorRT FP16 atrás de `VISION_TENSORRT` (desligado), com cache em volume | 5, 7 |
| Benchmark: fotos/s, tempo por etapa, pico de VRAM, lote 1/8/16 × det_size 640/1024 | 8 |
| Testes pytest: EXIF, filtros, validações da selfie com imagens, falha sem CUDA | 2, 3, 5, 6 |
| Containers `vision` na estação (GPU) e na VPS (selfie-cpu, tmpfs compartilhado); dois vision no dev | 7 |
