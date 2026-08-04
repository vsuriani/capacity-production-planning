"""Mostra formulas e valores de uma aba do dump em notacao A1, para leitura humana.

Uso: python scripts/show_tab.py "Nome da Aba" [linha_inicial] [linha_final] [--valores]
"""

import json
import sys
from pathlib import Path

DUMP = Path(".cache/sheet-dump")


def col(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def main():
    aba = sys.argv[1]
    ini = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    fim = int(sys.argv[3]) if len(sys.argv) > 3 else 40
    fonte = "values.json" if "--valores" in sys.argv else "formulas.json"

    data = json.loads((DUMP / fonte).read_text(encoding="utf-8"))
    meta = json.loads((DUMP / "metadata.json").read_text(encoding="utf-8"))
    titles = [s["properties"]["title"] for s in meta["sheets"]]
    vr = data["valueRanges"][titles.index(aba)]

    for r, row in enumerate(vr.get("values", []), start=1):
        if not (ini <= r <= fim):
            continue
        for c, cell in enumerate(row):
            if cell not in ("", None):
                print(f"{col(c)}{r}\t{cell}")
        print("--")


if __name__ == "__main__":
    main()
