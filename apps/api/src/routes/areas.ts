import { Router } from "express";
import type { tPapel } from "../services/config";
import fotografoRoute from "./fotografoRoute";
import painelRoute from "./painelRoute";
import participanteRoute from "./participanteRoute";
import anfitriaoRoute from "./anfitriaoRoute";
import adminRoute from "./adminRoute";
import estacaoRoute from "./estacaoRoute";

export interface iArea {
    caminho: string;
    router: Router;
}

const AREAS: Record<tPapel, iArea[]> = {
    estacao: [
        { caminho: "fotografo", router: fotografoRoute },
        { caminho: "painel", router: painelRoute },
    ],
    vps: [
        { caminho: "participante", router: participanteRoute },
        { caminho: "anfitriao", router: anfitriaoRoute },
        { caminho: "admin", router: adminRoute },
        { caminho: "estacao", router: estacaoRoute },
    ],
};

export function areasDoPapel(papel: tPapel): iArea[] {
    return AREAS[papel];
}
