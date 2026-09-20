# Benchmark do vision-service na RTX 4070

- **Data:** 2026-09-20
- **GPU:** NVIDIA GeForce RTX 4070, 12 GB (12282 MiB)
- **Driver NVIDIA:** 580.173.02
- **Bibliotecas:** `onnxruntime-gpu[cuda,cudnn]==1.30.0`, `insightface==2.0`, modelo `buffalo_l` (`det_10g` + `w600k_r50`)
- **Fotos:** 200 fotos **sintéticas**, derivadas da amostra `t1` do insightface (6 rostos) ampliada para 6000×4153 e espelhada alternadamente (`cv2.flip`), não fotos reais de evento. Servem para medir vazão de hardware, não para validar taxa de detecção em condições reais.

O comando `python benchmark.py --pasta /data/dados/fotos-benchmark --limite 200` mede, para cada combinação de `det_size` e tamanho de lote, o tempo total (fotos/s) e quatro decomposições por foto. `decodificação ms/foto (por thread)` é o tempo de decodificação de UMA chamada rodando dentro do pool de threads: ele se sobrepõe ao trabalho da GPU e às outras threads, então **não é somável** com as demais colunas. `espera pela decodificação ms/foto` é, ao contrário, o tempo que a thread principal realmente ficou parada esperando a próxima imagem decodificada antes de montar o lote — essa é a contribuição real ao caminho crítico, de modo que `espera pela decodificação + detecção + reconhecimento ≈ 1000 / fotos_s`.

200 fotos de `/data/dados/fotos-benchmark`

| det_size | lote | fotos/s | espera pela decodificação ms/foto | detecção ms/foto | reconhecimento ms/foto | decodificação ms/foto (por thread) | rostos/foto | pico VRAM MB |
|---|---|---|---|---|---|---|---|---|
| 640 | 1 | 17.1 | 9.7 | 7.3 | 41.5 | 39.5 | 5.0 | 6567 |
| 640 | 8 | 71.4 | 1.4 | 6.8 | 5.6 | 34.3 | 5.0 | 6968 |
| 640 | 16 | 72.8 | 1.4 | 6.4 | 5.6 | 35.2 | 5.0 | 7996 |
| 1024 | 1 | 15.2 | 8.0 | 15.7 | 42.3 | 32.0 | 5.5 | 6815 |
| 1024 | 8 | 44.0 | 1.5 | 15.2 | 5.8 | 33.3 | 5.5 | 7490 |
| 1024 | 16 | 43.7 | 1.3 | 15.4 | 5.9 | 35.6 | 5.5 | 8384 |

## Conclusão

1. **Vazão nos padrões (`det_size` 1024, lote 16):** 43.7 fotos/s ≈ **2.622 fotos/min**. A meta do spec (seção 6) é p95 de latência upload → publicada < 10 min, com 20.000 fotos em 2 dias — o que exige em média só ~6,9 fotos/min. A GPU sozinha processa cerca de **377× essa média**, então a vazão bruta do vision não é o gargalo da meta; o p95 de 10 min depende muito mais da fila/orquestração do pipeline (upload, worker, fila) do que do throughput de inferência.
2. **Etapa que mais pesa:** usando a coluna correta (`espera pela decodificação`, não a decodificação por thread), no ponto padrão (1024/16) o caminho crítico por foto é ≈ 1,3 ms de espera + 15,4 ms de detecção + 5,9 ms de reconhecimento ≈ 22,6 ms — e a **detecção responde por ~68%** desse total, mais da metade. Pela regra do plano, a recomendação é **re-exportar o `det_10g` com lote dinâmico** (risco da seção 6 do spec), em vez de mexer em `VISION_DECODE_THREADS` (a espera pela decodificação já é pequena e não é o fator dominante).
3. **Pico de VRAM:** o maior valor observado foi 8.384 MB (det_size 1024, lote 16), contra o orçamento de 12.282 MB — cerca de 68% de uso, com ~3,9 GB de folga. Cabe overhead de outros processos na estação sem estourar a GPU.

## Riscos

- A licença dos modelos `buffalo_l` é **"non-commercial research only"**. O usuário precisa decidir sobre isso antes do primeiro evento pago (uso comercial pode exigir modelo alternativo ou licenciamento).
- A diferença de embeddings entre a GPU (estação, `CUDAExecutionProvider`) e a CPU (VPS, `CPUExecutionProvider`) é esperada e fica a cargo da calibração da fase 4 para ser absorvida.

## Observações

Dois pontos deixados em aberto pela revisão final da Task 7 foram checados com hardware GPU real:

- **Log de aquecimento:** ao subir o `vision-gpu` na RTX 4070, o log mostrou `[Vision] Modo gpu, det_size 1024, providers {...CUDAExecutionProvider...}` seguido de `[Vision] Aquecimento concluído em 0.5s`, sem traceback nem crash. O aquecimento do `carregar_motor` funciona normalmente em GPU real.
- **Ruído `VerifyOutputSizes` do ONNX:** o aviso `Expected shape from model of {1,512} does not match actual shape of {N,512} for output 683` (visto antes só no caminho de selfie em CPU) também aparece na GPU, tanto na chamada `/detect` isolada quanto, de forma repetida, durante o benchmark (uma linha por lote com mais de um rosto). Continua parecendo benigno — é só o onnxruntime reportando shape dinâmica —, mas com a vazão observada ele vira um volume de log considerável; vale um ajuste de nível de log mais adiante, fora do escopo deste benchmark.
