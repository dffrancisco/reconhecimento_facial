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
