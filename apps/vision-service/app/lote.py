import asyncio
import contextlib
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger("vision")


class MicroLote:
    def __init__(self, processar: Callable[[list], list], lote_max: int, espera_s: float):
        self._processar = processar
        self._lote_max = lote_max
        self._espera_s = espera_s
        self._fila: asyncio.Queue | None = None
        self._tarefa: asyncio.Task | None = None
        self._parado = False
        # Uma thread só: a GPU processa um lote por vez e o event loop segue livre para decodificar e receber.
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="inferencia")

    @property
    def tamanho_fila(self) -> int:
        return self._fila.qsize() if self._fila else 0

    async def iniciar(self) -> None:
        self._fila = asyncio.Queue()
        self._tarefa = asyncio.create_task(self._rodar())
        self._tarefa.add_done_callback(self._logar_erro_inesperado)

    def _logar_erro_inesperado(self, tarefa: asyncio.Task) -> None:
        if tarefa.cancelled():
            return
        erro = tarefa.exception()
        if erro is not None:
            log.error("[Vision] MicroLote encerrou com erro inesperado: %s", erro)

    async def parar(self) -> None:
        self._parado = True
        if self._tarefa:
            self._tarefa.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._tarefa
            # Itens que nunca chegaram a entrar num lote: sobraram na fila quando a tarefa foi cancelada.
            while self._fila is not None and not self._fila.empty():
                _, futuro = self._fila.get_nowait()
                if not futuro.done():
                    futuro.set_exception(RuntimeError("MicroLote parado"))
        self._executor.shutdown(wait=False)

    async def enviar(self, item):
        if self._fila is None:
            raise RuntimeError("MicroLote não iniciado")
        if self._parado:
            raise RuntimeError("MicroLote parado")
        futuro = asyncio.get_running_loop().create_future()
        await self._fila.put((item, futuro))
        return await futuro

    def _resolver_erro(self, lote: list, erro: Exception) -> None:
        for _, futuro in lote:
            if not futuro.done():
                futuro.set_exception(erro)

    async def _juntar(self) -> list:
        loop = asyncio.get_running_loop()
        lote = [await self._fila.get()]
        limite = loop.time() + self._espera_s
        try:
            while len(lote) < self._lote_max:
                restante = limite - loop.time()
                if restante <= 0:
                    break
                try:
                    lote.append(await asyncio.wait_for(self._fila.get(), restante))
                except asyncio.TimeoutError:
                    break
        except asyncio.CancelledError:
            # parar() cancelou enquanto o lote ainda estava sendo montado: quem já saiu da fila precisa de resposta.
            self._resolver_erro(lote, RuntimeError("MicroLote parado"))
            raise
        return lote

    async def _rodar(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            lote = await self._juntar()
            itens = [item for item, _ in lote]
            try:
                resultados = await loop.run_in_executor(self._executor, self._processar, itens)
            except asyncio.CancelledError:
                # parar() cancelou com o lote já entregue à thread de inferência.
                self._resolver_erro(lote, RuntimeError("MicroLote parado"))
                raise
            except Exception as erro:
                self._resolver_erro(lote, erro)
                continue
            for indice, (_, futuro) in enumerate(lote):
                if futuro.done():
                    continue
                if indice < len(resultados):
                    futuro.set_result(resultados[indice])
                else:
                    # processar() devolveu menos itens do que recebeu: sem isso o zip truncava e deixava o item pendurado.
                    futuro.set_exception(RuntimeError("MicroLote: processamento não retornou resultado para este item"))
