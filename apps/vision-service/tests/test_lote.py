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
