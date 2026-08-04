"""Confere se a formula de 'Operadores Linha' casa a Meta (col B) com a Qtd da mesma linha.

A formula soma pares (Meta_da_linha_X * Qtd_da_linha_Y). Se X != Y, o tempo-padrao de um
dispositivo esta sendo multiplicado pela quantidade de outro.
"""

import json
import re
import sys
from pathlib import Path

DUMP = Path(".cache/sheet-dump")


def load():
    f = json.loads((DUMP / "formulas.json").read_text(encoding="utf-8"))
    v = json.loads((DUMP / "values.json").read_text(encoding="utf-8"))
    m = json.loads((DUMP / "metadata.json").read_text(encoding="utf-8"))
    t = [s["properties"]["title"] for s in m["sheets"]]
    return f, v, t


def nome_col(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def analisar(aba, linha_formula, primeira, ultima, coluna=None):
    f, v, t = load()
    i = t.index(aba)
    vals = v["valueRanges"][i]["values"]
    nomes = {}
    for r in range(primeira, ultima + 1):
        row = vals[r - 1] if r - 1 < len(vals) else []
        nomes[r] = str(row[0]) if row else ""

    fx = f["valueRanges"][i]["values"][linha_formula - 1]
    if coluna:
        celula = next(
            c for j, c in enumerate(fx)
            if isinstance(c, str) and c.startswith("=") and nome_col(j) == coluna
        )
        letra = coluna
    else:
        celula = next(c for c in fx if isinstance(c, str) and c.startswith("="))
        letra = re.match(r".*?\$B\$\d+\*([A-Z]+)\d+", celula).group(1)

    pat = re.compile(
        r"\$B\$(\d+)\s*\*\s*" + letra + r"(\d+)"
        r"|" + letra + r"(\d+)\s*\*\s*\$B\$(\d+)"
    )
    pares = []
    for mt in pat.finditer(celula):
        meta = mt.group(1) or mt.group(4)
        qtd = mt.group(2) or mt.group(3)
        pares.append((int(meta), int(qtd)))

    print(f"=== {aba} — formula {letra}{linha_formula} ({len(pares)} termos) ===")
    usados = set()
    for meta, qtd in pares:
        usados.add(qtd)
        flag = "" if meta == qtd else "  <<< DESALINHADO"
        print(
            f"  Meta B{meta} ({nomes.get(meta, '?')[:26]:<26}) x Qtd {letra}{qtd} "
            f"({nomes.get(qtd, '?')[:26]:<26}){flag}"
        )
    faltando = [r for r in range(primeira, ultima + 1) if r not in usados and nomes.get(r)]
    if faltando:
        print("  FORA DA CONTA:", ", ".join(f"{r} ({nomes[r]})" for r in faltando))
    print()


if __name__ == "__main__":
    # bloco semanal (colunas E..R) e bloco mensal (colunas S..AF)
    analisar("Planejamento Mensal", 24, 3, 21, "E")
    analisar("Planejamento Mensal", 24, 3, 21, "S")
    analisar("Planejamento Semanal", 27, 3, 24, "E")
    analisar("Planejamento Semanal", 27, 3, 24, "S")
