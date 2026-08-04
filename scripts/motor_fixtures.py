"""Extrai fixtures de teste do dump da planilha para validar o motor.

Os testes do motor precisam bater com os NUMEROS REAIS da planilha, nao com suposicoes.
Este script le .cache/sheet-dump/ (gerado por dump_sheet.py) e escreve
api/_lib/motor/fixtures.json com:

  - os termos da formula "Operadores Linha" como estao na planilha, incluindo os que
    apontam para a linha de outro dispositivo ou para a coluna de outro periodo
  - as metas e as demandas de todos os periodos
  - os dias uteis
  - o headcount que a planilha exibe hoje, e se ele e ROUNDUP ou valor digitado

Uso:
    python scripts/dump_sheet.py <spreadsheet_id>     # se .cache estiver vazio
    python scripts/motor_fixtures.py
"""

import json
import re
from pathlib import Path

DUMP = Path(".cache/sheet-dump")
SAIDA = Path("api/_lib/motor/fixtures.json")

# aba -> (linha da formula, primeira/ultima linha de dispositivo, linha de dias uteis)
ABAS = {
    "Planejamento Mensal": {"formula": 24, "primeira": 3, "ultima": 21, "dias_uteis": 23},
    "Planejamento Semanal": {"formula": 27, "primeira": 3, "ultima": 24, "dias_uteis": 26},
}

# ($B$<linha> * <col><linha>) ou (<col><linha> * $B$<linha>)
TERMO = re.compile(r"\$B\$(\d+)\s*\*\s*([A-Z]+)(\d+)|([A-Z]+)(\d+)\s*\*\s*\$B\$(\d+)")


def nome_col(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def celula(grade, linha, coluna):
    row = grade[linha - 1] if linha - 1 < len(grade) else []
    return row[coluna] if coluna < len(row) else ""


def extrair_termos(formula):
    """[(linha_da_meta, coluna_da_qtd, linha_da_qtd)] na ordem da formula."""
    termos = []
    for m in TERMO.finditer(formula):
        if m.group(1):
            termos.append((int(m.group(1)), m.group(2), int(m.group(3))))
        else:
            termos.append((int(m.group(6)), m.group(4), int(m.group(5))))
    return termos


TIPO_LINHA = {
    "Defasagem": "defasagem",
    "Industrialização": "industrializacao",
    "Produção / Montagem": "producao_montagem",
}

# Uniao dos arrays de Code.gs e Codigo.gs. Code.gs e codigo morto (sobreposto pelo
# Codigo.gs), mas o mapeamento e a intencao mais recente do time.
SKU_PRODUTO = {
    "producao": {
        "Gateway Pro": ["PROD-0020", "PROD-0032"],
        "Smart Receiver Ultra": ["PROD-0048", "PROD-0050", "PROD-0071"],
        "Smart Trac Pro": ["PROD-0062", "PROI-0062", "PROD-0063"],
        "Smart Trac Ultra": ["PROD-0091", "PROI-0110", "PROD-0110", "PROI-0109", "PROD-0109"],
        "Smart Trac Ultra Ex": ["PROD-0046", "PROD-0051", "PROD-0113", "PROD-0114"],
        "Energy Trac": ["PROD-0084", "PROD-0083", "PROD-0087"],
        "Uni Trac": ["PROD-0078", "PROD-0079", "PROD-0080", "PROD-0081", "PROD-0082", "PROI-0071"],
        "Smart Trac Ultra Gen 2": ["PROD-0140", "PROD-0152", "PROD-0153"],
        "Smart Trac Ultra Ex Gen 2": ["PROD-0164"],
        "UniTrac 2.0": ["PROD-0150", "PROD-0147", "PROD-0149", "PROD-0148"],
        "OEE Trac": ["PROD-0156"],
        "Omni Trac": ["PROD-0154"],
        "Omni Receiver": ["PROD-0127"],
        "Omni Receiver MX": ["PROD-0172"],
    },
    "industrializacao": {
        "Smart Trac Pro": ["PROA-0002", "ITCS-0009"],
        "Smart Trac Ultra": [
            "ENCG-0011", "ENCG-0006", "PROA-0007", "PROD-0109", "PROD-0110",
            "PROI-0069", "PROD-0132", "ENCG-0026",
        ],
        "Smart Trac Ultra Ex": [
            "PROD-0046", "PROD-0051", "ITCS-0002", "PROD-0113", "PROD-0114",
            "ENCG-0017", "ENCG-0018",
        ],
        "Smart Trac Ultra Ex Gen 2": ["ITCS-0019"],
        "Energy Trac": ["PROA-0013", "ITCS-0001"],
        "Uni Trac": ["PROD-0079", "PROD-0080", "PROD-0081", "PROD-0082", "PROD-0078"],
        "Baterias": ["ITCS-0002", "ITCS-0012", "ITCS-0014", "ITCS-0015", "ITCS-0019", "ITCH-0011"],
        "OEE Trac": ["ITCH-0011"],
    },
}


def extrair_roteiros(gv):
    """Linhas da Base simplificada -> lista de processos."""
    processos = []
    for i, row in enumerate(gv[1:], start=2):
        if not row or not row[0]:
            continue
        campo = lambda c: row[c] if c < len(row) else ""
        tipo = TIPO_LINHA.get(str(campo(0)).strip())
        if not tipo:
            continue
        processos.append(
            {
                "id": i,
                "produto": str(campo(1)),
                "tipoLinha": tipo,
                "nome": str(campo(3)),
                "sequencia": campo(4) or None,
                "paralelismo": campo(5) or None,
                "leadtimeDias": campo(6) or 0,
                "operadores": campo(7) or None,
                "pcsHora": campo(8) or 0,
                "skuFilho": str(campo(2)).strip() if str(campo(2)).strip() != "-" else None,
            }
        )
    return processos


def extrair_slots(gv):
    """Grade da Projecao das linhas -> slots {data, bloco, sku, qtd}."""
    slots = []
    blocos = (("producao", 9, 18), ("industrializacao", 20, 29))
    for semana in range(5):
        for dia in range(6):
            c = (3 + 13 * semana + dia * 2) - 1  # 0-indexed
            serial = gv[5][c] if 5 < len(gv) and c < len(gv[5]) else ""
            if not isinstance(serial, (int, float)):
                continue
            # serial do Sheets: dias desde 1899-12-30
            from datetime import date, timedelta

            data = (date(1899, 12, 30) + timedelta(days=int(serial))).isoformat()
            for bloco, ini, fim in blocos:
                for linha in range(ini, fim + 1):
                    row = gv[linha - 1] if linha - 1 < len(gv) else []
                    sku = str(row[c]).strip() if c < len(row) and row[c] != "" else ""
                    qtd = row[c + 1] if c + 1 < len(row) and isinstance(row[c + 1], (int, float)) else 0
                    if sku:
                        slots.append(
                            {"data": data, "bloco": bloco, "skuCodigo": sku, "quantidade": qtd}
                        )
    return slots


def main():
    formulas = json.loads((DUMP / "formulas.json").read_text(encoding="utf-8"))
    valores = json.loads((DUMP / "values.json").read_text(encoding="utf-8"))
    meta = json.loads((DUMP / "metadata.json").read_text(encoding="utf-8"))
    titulos = [s["properties"]["title"] for s in meta["sheets"]]

    saida = {"abas": {}}

    for aba, cfg in ABAS.items():
        i = titulos.index(aba)
        gf = formulas["valueRanges"][i].get("values", [])
        gv = valores["valueRanges"][i].get("values", [])

        dispositivos = {}
        for linha in range(cfg["primeira"], cfg["ultima"] + 1):
            nome = celula(gv, linha, 0)
            if nome:
                dispositivos[linha] = {"nome": str(nome), "meta": celula(gv, linha, 1) or 0}

        linha_formula = gf[cfg["formula"] - 1] if cfg["formula"] - 1 < len(gf) else []
        linha_arred = gf[cfg["formula"]] if cfg["formula"] < len(gf) else []

        # demanda e dias uteis de TODAS as colunas: um termo pode apontar para outra
        colunas = {}
        periodos = []

        for c, conteudo in enumerate(linha_formula):
            if not (isinstance(conteudo, str) and conteudo.startswith("=")):
                continue
            letra = nome_col(c)
            termos = extrair_termos(conteudo)
            if not termos:
                continue

            bruto_arred = linha_arred[c] if c < len(linha_arred) else ""
            arred_eh_formula = isinstance(bruto_arred, str) and bruto_arred.upper().startswith(
                "=ROUNDUP"
            )

            periodos.append(
                {
                    "coluna": letra,
                    "rotulo": str(celula(gv, 2, c) or letra),
                    "termos": [
                        {"metaLinha": a, "qtdColuna": b, "qtdLinha": d} for a, b, d in termos
                    ],
                    "diasUteis": celula(gv, cfg["dias_uteis"], c) or 0,
                    "planilhaFracionario": celula(gv, cfg["formula"], c),
                    "planilhaArredondado": celula(gv, cfg["formula"] + 1, c),
                    "arredondadoEhFormula": arred_eh_formula,
                }
            )

        # varre um alcance generoso de colunas para cobrir as referencias cruzadas
        largura = max(len(r) for r in gv if r) if gv else 0
        for c in range(largura):
            letra = nome_col(c)
            demandas = {
                str(linha): celula(gv, linha, c) or 0
                for linha in dispositivos
                if celula(gv, linha, c) != ""
            }
            if demandas:
                colunas[letra] = demandas

        saida["abas"][aba] = {
            "coefEficiencia": celula(gv, cfg["formula"] + 1, 1) or 0.85,
            "dispositivos": {str(k): v for k, v in dispositivos.items()},
            "demandasPorColuna": colunas,
            "periodos": periodos,
        }

    # ---- roteiros, mapa SKU->produto e a grade real de producao ----
    base = valores["valueRanges"][titulos.index("Base simplificada")].get("values", [])
    proj = valores["valueRanges"][titulos.index("Projeção das linhas")].get("values", [])

    saida["roteiros"] = extrair_roteiros(base)
    saida["skuProduto"] = SKU_PRODUTO
    saida["slots"] = extrair_slots(proj)

    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(saida, indent=2, ensure_ascii=False), encoding="utf-8")

    for aba, dados in saida["abas"].items():
        cruzados = sum(
            1
            for p in dados["periodos"]
            for termo in p["termos"]
            if termo["qtdColuna"] != p["coluna"]
        )
        print(
            f"{aba}: {len(dados['dispositivos'])} dispositivos, "
            f"{len(dados['periodos'])} periodos, {cruzados} termo(s) de outra coluna"
        )
    print(f"roteiros: {len(saida['roteiros'])} processos")
    print(f"slots: {len(saida['slots'])} demandas na grade")
    print(f"-> {SAIDA}")


if __name__ == "__main__":
    main()
