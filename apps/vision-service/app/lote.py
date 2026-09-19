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
