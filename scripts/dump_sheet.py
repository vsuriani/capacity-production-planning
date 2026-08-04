"""Dump da estrutura e das formulas de uma planilha Google, para engenharia reversa.

Credencial NUNCA fica no repo: aponte GOOGLE_APPLICATION_CREDENTIALS para o arquivo
da service account (ex.: %USERPROFILE%\\.secrets\\tractian-bi-operations-dashboard.json).

Uso:
    export GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/tractian-bi-operations-dashboard.json
    python scripts/dump_sheet.py <spreadsheet_id>

Saida em .cache/sheet-dump/ (gitignored - pode conter dado interno).
"""

import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
OUT = Path(".cache/sheet-dump")


def client():
    path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not path:
        sys.exit("defina GOOGLE_APPLICATION_CREDENTIALS com o caminho da service account")
    creds = service_account.Credentials.from_service_account_file(
        os.path.expanduser(path), scopes=SCOPES
    )
    return build("sheets", "v4", credentials=creds)


def main(sid):
    svc = client()
    OUT.mkdir(parents=True, exist_ok=True)

    meta = (
        svc.spreadsheets()
        .get(
            spreadsheetId=sid,
            fields=(
                "properties,namedRanges,"
                "sheets(properties,protectedRanges,conditionalFormats,charts,"
                "basicFilter,filterViews,bandedRanges,slicers)"
            ),
        )
        .execute()
    )
    (OUT / "metadata.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    titles = [s["properties"]["title"] for s in meta["sheets"]]

    # formulas (valueRenderOption=FORMULA) e valores calculados, por aba
    formulas = svc.spreadsheets().values().batchGet(
        spreadsheetId=sid,
        ranges=[f"'{t}'" for t in titles],
        valueRenderOption="FORMULA",
    ).execute()
    values = svc.spreadsheets().values().batchGet(
        spreadsheetId=sid,
        ranges=[f"'{t}'" for t in titles],
        valueRenderOption="UNFORMATTED_VALUE",
    ).execute()

    (OUT / "formulas.json").write_text(
        json.dumps(formulas, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (OUT / "values.json").write_text(
        json.dumps(values, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    # inventario: quais funcoes cada aba usa e de quem ela depende
    report = []
    for title, vr in zip(titles, formulas.get("valueRanges", [])):
        rows = vr.get("values", [])
        fx = [
            c for row in rows for c in row
            if isinstance(c, str) and c.startswith("=")
        ]
        funcs = Counter(
            f.upper() for cell in fx for f in re.findall(r"([A-Z_][A-Z0-9_.]*)\s*\(", cell.upper())
        )
        refs = Counter(
            m.strip("'") for cell in fx
            for m in re.findall(r"(?:'([^']+)'|\b([A-Za-z_][\w ]*))!", cell)
            for m in [m[0] or m[1]] if m
        )
        report.append(
            {
                "aba": title,
                "linhas_com_dado": len(rows),
                "celulas_com_formula": len(fx),
                "funcoes": funcs.most_common(),
                "referencia_outras_abas": refs.most_common(),
            }
        )
    (OUT / "inventario.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"dump em {OUT}/ ({len(titles)} abas)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else sys.exit("informe o spreadsheet_id"))
