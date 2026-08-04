"""Leitura e parsing da planilha "Dimensionamento de Linha".

SOMENTE LEITURA. O escopo pedido e sempre `spreadsheets.readonly` e nao existe nenhuma
funcao de escrita aqui — a planilha e a fonte de verdade do PCP e nao pode ser alterada.

Usado por:
  - scripts/motor_fixtures.py     (fixtures dos testes do motor)
  - scripts/importar_planilha.py  (carga inicial no banco do app)
"""

import json
import os
import re
from datetime import date, timedelta
from pathlib import Path

PLANILHA_ID = "1UWobn-ss5IY4cvG89hYrttCcXB_qc07PmbHsf8r7LNM"

# Ancorado na raiz do repo para o script funcionar de qualquer cwd.
RAIZ = Path(__file__).resolve().parent.parent
DUMP = RAIZ / ".cache" / "sheet-dump"
ESCOPO = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

TIPO_LINHA = {
    "Defasagem": "defasagem",
    "Industrialização": "industrializacao",
    "Produção / Montagem": "producao_montagem",
}

# Uniao dos arrays de Code.gs e Codigo.gs. O Code.gs e codigo morto (sobreposto pelo
# Codigo.gs no escopo global do Apps Script), mas o mapeamento e a intencao mais recente
# do time — por isso importamos a uniao e marcamos o que so existia no arquivo morto.
SKU_PRODUTO_ATIVO = {
    "producao": {
        "Gateway Pro": ["PROD-0020", "PROD-0032"],
        "Smart Receiver Ultra": ["PROD-0048", "PROD-0050", "PROD-0071"],
        "Smart Trac Pro": ["PROD-0062", "PROI-0062", "PROD-0063"],
        "Smart Trac Ultra": ["PROD-0091", "PROI-0110", "PROD-0110", "PROI-0109", "PROD-0109"],
        "Smart Trac Ultra Ex": ["PROD-0046", "PROD-0051", "PROD-0113", "PROD-0114"],
        "Energy Trac": ["PROD-0084", "PROD-0083", "PROD-0087"],
        "Uni Trac": ["PROD-0078", "PROD-0079", "PROD-0080", "PROD-0081", "PROD-0082", "PROI-0071"],
        "Smart Trac Ultra Gen 2": ["PROD-0140", "PROD-0152"],
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
        "Energy Trac": ["PROA-0013", "ITCS-0001"],
        "Uni Trac": ["PROD-0079", "PROD-0080", "PROD-0081", "PROD-0082", "PROD-0078"],
        "Baterias": ["ITCS-0002", "ITCS-0012", "ITCS-0014", "ITCS-0015"],
    },
}

# So no Code.gs (arquivo sobreposto = codigo morto hoje).
SKU_PRODUTO_MORTO = {
    "producao": {
        "Smart Trac Ultra Gen 2": ["PROD-0153"],
        "Smart Trac Ultra Ex Gen 2": ["PROD-0164"],
        "UniTrac 2.0": ["PROD-0150", "PROD-0147", "PROD-0149", "PROD-0148"],
        "OEE Trac": ["PROD-0156"],
        "Omni Trac": ["PROD-0154"],
        "Omni Receiver": ["PROD-0127"],
        "Omni Receiver MX": ["PROD-0172"],
    },
    "industrializacao": {
        "Smart Trac Ultra Ex Gen 2": ["ITCS-0019"],
        "Baterias": ["ITCS-0019", "ITCH-0011"],
        "OEE Trac": ["ITCH-0011"],
    },
}

# aba -> (linha da formula, primeira/ultima linha de dispositivo, linha de dias uteis)
ABAS_PLANEJAMENTO = {
    "Planejamento Mensal": {"formula": 24, "primeira": 3, "ultima": 21, "dias_uteis": 23},
    "Planejamento Semanal": {"formula": 27, "primeira": 3, "ultima": 24, "dias_uteis": 26},
}

TERMO = re.compile(r"\$B\$(\d+)\s*\*\s*([A-Z]+)(\d+)|([A-Z]+)(\d+)\s*\*\s*\$B\$(\d+)")


# ---------------------------------------------------------------- utilidades


def nome_col(i):
    """0 -> A, 25 -> Z, 26 -> AA"""
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def cel(grade, linha, coluna):
    """Celula 1-indexed por linha, 0-indexed por coluna. '' quando ausente."""
    row = grade[linha - 1] if 0 < linha <= len(grade) else []
    return row[coluna] if coluna < len(row) else ""


def num(valor, padrao=0):
    return valor if isinstance(valor, (int, float)) else padrao


def data_do_serial(serial):
    """Serial do Sheets (dias desde 1899-12-30) -> 'YYYY-MM-DD'."""
    if not isinstance(serial, (int, float)):
        return None
    return (date(1899, 12, 30) + timedelta(days=int(serial))).isoformat()


def extrair_termos(formula):
    """[(linha_da_meta, coluna_da_qtd, linha_da_qtd)] na ordem da formula."""
    termos = []
    for m in TERMO.finditer(formula):
        if m.group(1):
            termos.append((int(m.group(1)), m.group(2), int(m.group(3))))
        else:
            termos.append((int(m.group(6)), m.group(4), int(m.group(5))))
    return termos


# ---------------------------------------------------------------- fontes


class Planilha:
    """Acesso as grades de valores e de formulas, por nome de aba."""

    def __init__(self, titulos, valores, formulas):
        self.titulos = titulos
        self._valores = valores
        self._formulas = formulas

    def valores(self, aba):
        return self._valores[self.titulos.index(aba)]

    def formulas(self, aba):
        return self._formulas[self.titulos.index(aba)]


def do_dump():
    """Le do dump local gerado por scripts/dump_sheet.py."""
    formulas = json.loads((DUMP / "formulas.json").read_text(encoding="utf-8"))
    valores = json.loads((DUMP / "values.json").read_text(encoding="utf-8"))
    meta = json.loads((DUMP / "metadata.json").read_text(encoding="utf-8"))
    titulos = [s["properties"]["title"] for s in meta["sheets"]]
    return Planilha(
        titulos,
        [vr.get("values", []) for vr in valores["valueRanges"]],
        [vr.get("values", []) for vr in formulas["valueRanges"]],
    )


def da_api(planilha_id=PLANILHA_ID):
    """Le direto da Google Sheets API, com escopo de LEITURA."""
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    caminho = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not caminho:
        raise SystemExit("defina GOOGLE_APPLICATION_CREDENTIALS")

    creds = service_account.Credentials.from_service_account_file(
        os.path.expanduser(caminho), scopes=ESCOPO
    )
    svc = build("sheets", "v4", credentials=creds)

    meta = svc.spreadsheets().get(spreadsheetId=planilha_id, fields="sheets(properties)").execute()
    titulos = [s["properties"]["title"] for s in meta["sheets"]]
    faixas = [f"'{t}'" for t in titulos]

    valores = (
        svc.spreadsheets()
        .values()
        .batchGet(spreadsheetId=planilha_id, ranges=faixas, valueRenderOption="UNFORMATTED_VALUE")
        .execute()
    )
    formulas = (
        svc.spreadsheets()
        .values()
        .batchGet(spreadsheetId=planilha_id, ranges=faixas, valueRenderOption="FORMULA")
        .execute()
    )

    return Planilha(
        titulos,
        [vr.get("values", []) for vr in valores["valueRanges"]],
        [vr.get("values", []) for vr in formulas["valueRanges"]],
    )


# ---------------------------------------------------------------- parsers


def parse_sku(p):
    """Aba 'Base de PROD' -> catalogo de itens.

    A aba tem codigos repetidos (216 linhas, 199 codigos): cada duplicata aparece uma vez
    com descricao e outra sem. Mesclamos por codigo mantendo o valor NAO vazio de cada
    campo, para nao perder a descricao, e devolvemos a lista de duplicatas como aviso.

    @returns (itens, duplicados)
    """
    gv = p.valores("Base de PROD")
    por_codigo = {}
    vezes = {}

    for row in gv[1:]:
        if not row or not str(row[0]).strip():
            continue
        campo = lambda c: str(row[c]).strip() if c < len(row) else ""
        codigo = str(row[0]).strip()
        vezes[codigo] = vezes.get(codigo, 0) + 1

        novo = {
            "codigo": codigo,
            "descricao": campo(1),
            "grupoItem": campo(3) or None,
            "ncm": campo(4) or None,
        }
        atual = por_codigo.get(codigo)
        if atual is None:
            por_codigo[codigo] = novo
        else:
            # Mescla: o primeiro valor nao vazio ganha.
            for chave in ("descricao", "grupoItem", "ncm"):
                if not atual.get(chave) and novo.get(chave):
                    atual[chave] = novo[chave]

    duplicados = [
        {"tipo": "sku-duplicado-na-base-prod", "sku": c, "ocorrencias": n}
        for c, n in sorted(vezes.items())
        if n > 1
    ]
    return list(por_codigo.values()), duplicados


def parse_roteiros(p):
    """Aba 'Base simplificada' -> processos + produtos + aliases.

    O nome canonico do produto e o texto com trim; o alias guarda a grafia original
    (ha "Smart Trac Ultra Gen 2 " com espaco no fim, que a planilha trata como outro
    produto).
    """
    gv = p.valores("Base simplificada")
    processos = []
    aliases = {}

    for i, row in enumerate(gv[1:], start=2):
        if not row or not str(row[0]).strip():
            continue
        campo = lambda c: row[c] if c < len(row) else ""

        tipo = TIPO_LINHA.get(str(campo(0)).strip())
        if not tipo:
            continue

        bruto = str(campo(1))
        canonico = bruto.strip()
        if not canonico:
            continue
        if bruto != canonico:
            aliases[bruto] = canonico

        filho = str(campo(2)).strip()
        pcs_hora = num(campo(8), None)
        total_dia = num(campo(9), None)

        # J = I*8 nas linhas de cima, I = J/8 nas de baixo: registra de onde veio o dado.
        origem = "taxa"
        if pcs_hora is None and total_dia is not None:
            origem = "total"

        processos.append(
            {
                "ordem": i,
                "produto": canonico,
                "tipoLinha": tipo,
                "nome": str(campo(3)),
                "sequencia": num(campo(4), None),
                "paralelismo": num(campo(5), None),
                "leadtimeDias": int(num(campo(6), 0)),
                "operadores": num(campo(7), None),
                "pcsHora": pcs_hora,
                "skuFilho": filho if filho and filho != "-" else None,
                "origemTotalDia": origem,
            }
        )

    produtos = sorted({pr["produto"] for pr in processos})
    return processos, produtos, aliases


def parse_sku_produto():
    """Os arrays hardcoded dos .gs -> linhas de sku_produto."""
    linhas = []
    for morto, fonte in ((False, SKU_PRODUTO_ATIVO), (True, SKU_PRODUTO_MORTO)):
        for escopo, por_produto in fonte.items():
            for produto, skus in por_produto.items():
                for sku in skus:
                    linhas.append(
                        {
                            "skuCodigo": sku,
                            "produto": produto,
                            "escopo": escopo,
                            "soNoCodigoMorto": morto,
                        }
                    )
    return linhas


def parse_planejamento(p, aba):
    """Aba 'Planejamento Mensal'/'Semanal' -> cenario com metas, demandas, periodos, termos."""
    cfg = ABAS_PLANEJAMENTO[aba]
    gv = p.valores(aba)
    gf = p.formulas(aba)

    dispositivos = {}
    for linha in range(cfg["primeira"], cfg["ultima"] + 1):
        nome = str(cel(gv, linha, 0)).strip()
        if nome:
            dispositivos[linha] = nome

    linha_formula = gf[cfg["formula"] - 1] if cfg["formula"] - 1 < len(gf) else []
    linha_arred = gf[cfg["formula"]] if cfg["formula"] < len(gf) else []

    # coluna -> rotulo do periodo (linha 2)
    rotulo_da_coluna = {}
    largura = max((len(r) for r in gv if r), default=0)
    for c in range(largura):
        rot = str(cel(gv, 2, c)).strip()
        if rot:
            rotulo_da_coluna[nome_col(c)] = rot

    periodos = []
    termos = []
    demandas = []
    metas = {}
    ordem_termo = 0

    for linha, nome in dispositivos.items():
        metas[nome] = num(cel(gv, linha, 1), 0)

    for c, conteudo in enumerate(linha_formula):
        if not (isinstance(conteudo, str) and conteudo.startswith("=")):
            continue
        letra = nome_col(c)
        lista = extrair_termos(conteudo)
        if not lista:
            continue

        rotulo = rotulo_da_coluna.get(letra, letra)
        bruto_arred = linha_arred[c] if c < len(linha_arred) else ""
        eh_roundup = isinstance(bruto_arred, str) and bruto_arred.upper().startswith("=ROUNDUP")

        periodos.append(
            {
                "periodo": rotulo,
                "ordem": len(periodos),
                "diasUteis": num(cel(gv, cfg["dias_uteis"], c), 0),
                "arredondadoManual": None if eh_roundup else num(cel(gv, cfg["formula"] + 1, c), None),
            }
        )

        for meta_linha, qtd_col, qtd_linha in lista:
            if meta_linha not in dispositivos or qtd_linha not in dispositivos:
                continue
            qtd_rotulo = rotulo_da_coluna.get(qtd_col, qtd_col)
            termos.append(
                {
                    "periodo": rotulo,
                    "metaDispositivo": dispositivos[meta_linha],
                    "qtdDispositivo": dispositivos[qtd_linha],
                    "qtdPeriodo": None if qtd_rotulo == rotulo else qtd_rotulo,
                    "ordem": ordem_termo,
                }
            )
            ordem_termo += 1

        for linha, nome in dispositivos.items():
            valor = cel(gv, linha, c)
            if isinstance(valor, (int, float)):
                demandas.append({"dispositivo": nome, "periodo": rotulo, "quantidade": valor})

    return {
        "nome": f"{aba} (importado)",
        "tipo": "mensal" if aba == "Planejamento Mensal" else "semanal",
        "dispositivos": list(dispositivos.values()),
        "metas": metas,
        "periodos": periodos,
        "demandas": demandas,
        "termos": termos,
    }


def parse_global(p):
    """Aba '🚧 Dimensionamento Global' -> cenario de capacidade."""
    aba = "🚧 Dimensionamento Global"
    gv = p.valores(aba)
    gf = p.formulas(aba)

    # Bloco de cima: dispositivo (col A sem "-") seguido dos componentes ("- ...").
    componentes = []
    dispositivos = []
    atual = None
    ordem = 0
    for linha in range(4, 56):
        nome = str(cel(gv, linha, 0)).strip()
        if not nome:
            continue
        if not nome.startswith("-"):
            atual = nome
            dispositivos.append(nome)
            ordem = 0
            continue
        if atual is None:
            continue

        rotulo = nome.lstrip("- ").strip()
        alvo = rotulo.lower()
        if alvo.startswith("ftr"):
            papel = "ftr"
        elif alvo.startswith("retrabalho"):
            papel = "retrabalho"
        else:
            papel = "aditivo"

        componentes.append(
            {
                "dispositivo": atual,
                "ordem": ordem,
                "rotulo": rotulo,
                "papel": papel,
                "valor": num(cel(gv, linha, 2), 0),
            }
        )
        ordem += 1

    # Bloco de baixo: demanda mensal (linha 61 = rotulos, 62..72 = dispositivos,
    # 73 = dias uteis, 74 = calculado, 75 = headcount exibido).
    largura = max((len(r) for r in gv if r), default=0)
    colunas = {}
    for c in range(largura):
        rot = str(cel(gv, 61, c)).strip()
        if rot:
            colunas[c] = rot

    periodos = []
    demandas = []
    for c, rotulo in colunas.items():
        bruto = cel(gf, 75, c)
        eh_roundup = isinstance(bruto, str) and bruto.upper().startswith("=ROUNDUP")
        periodos.append(
            {
                "periodo": rotulo,
                "ordem": len(periodos),
                "diasUteis": num(cel(gv, 73, c), 0),
                "arredondadoManual": None if eh_roundup else num(cel(gv, 75, c), None),
            }
        )
        for linha in range(62, 73):
            nome = str(cel(gv, linha, 0)).strip()
            valor = cel(gv, linha, c)
            if nome and isinstance(valor, (int, float)):
                demandas.append({"dispositivo": nome, "periodo": rotulo, "quantidade": valor})

    # Um termo por dispositivo do bloco de baixo — a fórmula D74 está alinhada.
    termos = [
        {
            "periodo": per["periodo"],
            "metaDispositivo": nome,
            "qtdDispositivo": nome,
            "qtdPeriodo": None,
            "ordem": i,
        }
        for per in periodos
        for i, nome in enumerate(str(cel(gv, l, 0)).strip() for l in range(62, 73))
        if nome
    ]

    return {
        "nome": "Dimensionamento Global (importado)",
        "tipo": "capacidade",
        "dispositivos": dispositivos,
        "metas": {},  # a métrica vem dos componentes, não de uma coluna "Meta"
        "periodos": periodos,
        "demandas": demandas,
        "termos": termos,
        "metricaComponentes": componentes,
        "coefEficiencia": num(cel(gv, 56, 3), 0.85),
        "coefExcedente": num(cel(gv, 58, 3), 0.2),
    }


def parse_projecao(p):
    """Aba 'Projeção das linhas' -> mes/ano, operadores e slots da grade."""
    gv = p.valores("Projeção das linhas")
    mes = int(num(cel(gv, 1, 1), 0))
    ano = int(num(cel(gv, 2, 1), 0))
    operadores = int(num(cel(gv, 3, 1), 8))

    slots = []
    blocos = (("producao", 9, 18), ("industrializacao", 20, 29))
    for semana in range(5):
        for dia in range(6):
            c = (3 + 13 * semana + dia * 2) - 1
            data = data_do_serial(cel(gv, 6, c))
            if not data:
                continue
            for bloco, ini, fim in blocos:
                ordem = 0
                for linha in range(ini, fim + 1):
                    sku = str(cel(gv, linha, c)).strip()
                    if not sku:
                        continue
                    slots.append(
                        {
                            "data": data,
                            "bloco": bloco,
                            "ordem": ordem,
                            "skuCodigo": sku,
                            "quantidade": num(cel(gv, linha, c + 1), 0),
                        }
                    )
                    ordem += 1

    return {"mes": mes, "ano": ano, "qtdOperadores": operadores, "slots": slots}


def parse_demandas(p):
    """Aba 'Demandas Defasagem' -> linhas de demanda ja calculadas."""
    gv = p.valores("Demandas Defasagem")
    linhas = []
    for row in gv[1:]:
        if not row or not str(row[0]).strip():
            continue
        campo = lambda c: row[c] if c < len(row) else ""
        tipo = TIPO_LINHA.get(str(campo(0)).strip())
        if not tipo:
            continue
        dia_processo = data_do_serial(campo(1))
        dia_producao = data_do_serial(campo(2))
        if not dia_processo or not dia_producao:
            continue
        linhas.append(
            {
                "tipoLinha": tipo,
                "diaProcesso": dia_processo,
                "diaProducao": dia_producao,
                "skuCodigo": str(campo(3)).strip(),
                "processoNome": str(campo(4)),
                "quantidade": num(campo(5), 0),
                "operadores": num(campo(6), None),
                "pcsHora": num(campo(7), None),
                "tempoHoras": num(campo(8), None),
                "lote": str(campo(9)),
                "feito": campo(10) is True,
            }
        )
    return linhas


def parse_alocacao(p):
    """Aba 'Dimensionamento de Operadores' -> horas por operador por dia."""
    gv = p.valores("Dimensionamento de Operadores")
    if not gv:
        return []

    cabecalho = gv[0]
    qtd = sum(1 for c in cabecalho[1:] if str(c).strip().lower().startswith("operador"))

    linhas = []
    for row in gv[1:]:
        if not row:
            continue
        data = data_do_serial(row[0])
        if not data:
            continue
        for i in range(1, qtd + 1):
            valor = row[i] if i < len(row) else ""
            if isinstance(valor, (int, float)):
                linhas.append({"data": data, "operador": i, "horas": valor})
    return linhas
