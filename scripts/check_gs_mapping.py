"""Confere os mapeamentos hardcoded do Code.gs contra os dados reais da planilha.

1. Cada string de produto das funcoes processoXxx() existe na 'Base simplificada'?
2. Cada codigo SAP da 'Projeção das linhas' esta mapeado em algum array do Code.gs?
3. Algum codigo SAP aparece em mais de um array (gera linha duplicada)?
"""

import json
from collections import Counter, defaultdict
from pathlib import Path

DUMP = Path(".cache/sheet-dump")

# strings comparadas em cada funcao processoXxx() do Code.gs
PRODUTOS_NO_CODIGO = {
    "processoEnergy": "Energy Trac",
    "processoGatewayPro": "Gateway Pro",
    "processoGatewayUltra": "Smart Receiver Ultra",
    "processoSmartTracPro": "Smart Trac Pro",
    "processoSmartTracUltra": "Smart Trac Ultra",
    "processoSmartTracUltraGen2": "Smart Trac Ultra Gen 2",
    "processoSmartTracUltraEx": "Smart Trac Ultra Ex",
    "processoUniTrac": "Uni Trac",
    "processoUniTrac2": "UniTrac 2.0",
    "processoOEETrac": "OEE Trac",
    "processoOmniTrac": "Omni Trac",
    "processoOmniReceiver": "Omni Receiver",
    "processoSmartTracUltraExGen2": "Smart Trac Ultra Ex Gen 2",
    "processoOmniReceiverMX": "Omni Receiver MX",
    "processoBaterias": "Baterias",
}

# arrays de codigo SAP do calculoDefasagem()
SAP_DEFASAGEM = {
    "processoGatewayPro": ["PROD-0020", "PROD-0032"],
    "processoGatewayUltra": ["PROD-0048", "PROD-0050", "PROD-0071"],
    "processoSmartTracPro": ["PROD-0062", "PROI-0062", "PROD-0063"],
    "processoSmartTracUltra": ["PROD-0091", "PROI-0110", "PROD-0110", "PROI-0109", "PROD-0109"],
    "processoSmartTracUltraEx": ["PROD-0046", "PROD-0051", "PROD-0113", "PROD-0114"],
    "processoEnergy": ["PROD-0084", "PROD-0083", "PROD-0087"],
    "processoUniTrac": ["PROD-0078", "PROD-0079", "PROD-0080", "PROD-0081", "PROD-0082", "PROI-0071"],
    "processoSmartTracUltraGen2": ["PROD-0140", "PROD-0152", "PROD-0153"],
    "processoSmartTracUltraExGen2": ["PROD-0164"],
    "processoUniTrac2": ["PROD-0150", "PROD-0147", "PROD-0149", "PROD-0148"],
    "processoOEETrac": ["PROD-0156"],
    "processoOmniTrac": ["PROD-0154"],
    "processoOmniReceiver": ["PROD-0127"],
    "processoOmniReceiverMX": ["PROD-0172"],
}

# arrays de codigo SAP do calculoIndustrializacao()
SAP_INDUSTRIALIZACAO = {
    "processoSmartTracPro": ["PROA-0002", "ITCS-0009"],
    "processoSmartTracUltra": ["ENCG-0011", "ENCG-0006", "PROA-0007", "PROD-0109", "PROD-0110",
                               "PROI-0069", "PROD-0132", "ENCG-0026"],
    "processoSmartTracUltraEx": ["PROD-0046", "PROD-0051", "ITCS-0002", "PROD-0113", "PROD-0114",
                                 "ENCG-0017", "ENCG-0018"],
    "processoSmartTracUltraExGen2": ["ITCS-0019"],
    "processoEnergy": ["PROA-0013", "ITCS-0001"],
    "processoUniTrac": ["PROD-0079", "PROD-0080", "PROD-0081", "PROD-0082", "PROD-0078"],
    "processoBaterias": ["ITCS-0002", "ITCS-0012", "ITCS-0014", "ITCS-0015", "ITCS-0019", "ITCH-0011"],
    "processoOEETrac": ["ITCH-0011"],
}


def carregar():
    v = json.loads((DUMP / "values.json").read_text(encoding="utf-8"))
    m = json.loads((DUMP / "metadata.json").read_text(encoding="utf-8"))
    t = [s["properties"]["title"] for s in m["sheets"]]
    return v, t


def main():
    v, t = carregar()

    # --- 1. produtos do codigo x produtos da Base simplificada ---
    base = v["valueRanges"][t.index("Base simplificada")]["values"]
    linhas = [(str(r[0]) if len(r) > 0 else "", str(r[1]) if len(r) > 1 else "")
              for r in base[1:] if r]
    por_produto = Counter(p for _, p in linhas if p)

    print("=" * 78)
    print("1. As funcoes processoXxx() encontram linhas na 'Base simplificada'?")
    print("=" * 78)
    for func, prod in PRODUTOS_NO_CODIGO.items():
        n = por_produto.get(prod, 0)
        tipos = Counter(tp for tp, p in linhas if p == prod)
        status = "OK" if n else "*** VAZIO ***"
        print(f"  {status:<14} {func:<32} procura {prod!r} -> {n} linhas {dict(tipos)}")

    orfaos = [p for p in por_produto if p not in PRODUTOS_NO_CODIGO.values()]
    if orfaos:
        print("\n  Produtos na planilha que NENHUMA funcao le:")
        for p in orfaos:
            print(f"    {p!r} ({por_produto[p]} linhas)")

    # --- 2. codigos SAP da Projeção x arrays do codigo ---
    proj = v["valueRanges"][t.index("Projeção das linhas")]["values"]

    def sap_do_bloco(primeira, ultima):
        achados = Counter()
        for i in range(5):            # 5 semanas
            for j in range(6):        # 6 dias
                col = (3 + 13 * i + j * 2) - 1   # 0-indexed
                for r in range(primeira, ultima + 1):
                    row = proj[r - 1] if r - 1 < len(proj) else []
                    cod = str(row[col]).strip() if len(row) > col and row[col] != "" else ""
                    if cod:
                        achados[cod] += 1
        return achados

    for titulo, (ini, fim), mapa in (
        ("PRODUCAO (linhas 9-18) -> calculoDefasagem", (9, 18), SAP_DEFASAGEM),
        ("INDUSTRIALIZACAO (linhas 20-29) -> calculoIndustrializacao", (20, 29), SAP_INDUSTRIALIZACAO),
    ):
        print()
        print("=" * 78)
        print(f"2. Codigos SAP na 'Projeção das linhas' — {titulo}")
        print("=" * 78)
        conhecidos = {c: f for f, cs in mapa.items() for c in cs}
        for cod, qtd in sorted(sap_do_bloco(ini, fim).items()):
            func = conhecidos.get(cod)
            if not func:
                print(f"  *** SEM MAPEAMENTO ***  {cod:<12} ({qtd}x na grade) -> ignorado no relatorio")
            else:
                prod = PRODUTOS_NO_CODIGO[func]
                vazio = "  [mas a funcao volta VAZIA]" if not por_produto.get(prod) else ""
                print(f"  ok                      {cod:<12} ({qtd}x) -> {func}{vazio}")

    # --- 3. codigos SAP duplicados entre arrays ---
    print()
    print("=" * 78)
    print("3. Codigos SAP em mais de um array (geram linha duplicada, sem break)")
    print("=" * 78)
    for nome, mapa in (("calculoDefasagem", SAP_DEFASAGEM),
                       ("calculoIndustrializacao", SAP_INDUSTRIALIZACAO)):
        dup = defaultdict(list)
        for func, cods in mapa.items():
            for c in cods:
                dup[c].append(func)
        achou = {c: fs for c, fs in dup.items() if len(fs) > 1}
        print(f"  {nome}: {achou if achou else 'nenhum'}")


if __name__ == "__main__":
    main()
