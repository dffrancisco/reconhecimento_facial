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
