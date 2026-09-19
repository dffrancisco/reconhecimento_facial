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
