"""Carga inicial: le a planilha (SOMENTE LEITURA) e envia para POST /api/importacao.

A planilha nunca e escrita. Depois desta carga o app e a fonte da verdade; rode de novo
so se precisar re-sincronizar (a importacao e idempotente).

Uso:
    export GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/tractian-bi-operations-dashboard.json
    python scripts/importar_planilha.py                    # le da API e envia
    python scripts/importar_planilha.py --dump             # le do .cache local
    python scripts/importar_planilha.py --dry-run          # so monta e salva o payload
    python scripts/importar_planilha.py --api http://localhost:3101
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import planilha as pl  # noqa: E402

SAIDA_DRY = pl.RAIZ / ".cache" / "payload-importacao.json"


def montar_payload(p):
    sku, sku_duplicados = pl.parse_sku(p)
    processos, produtos, aliases = pl.parse_roteiros(p)
    sku_produto = pl.parse_sku_produto()

    projecao = pl.parse_projecao(p)
    mensais = pl.parse_planejamento_por_mes(p, "Planejamento Mensal", projecao["ano"])
    semanais = pl.parse_planejamento_por_mes(p, "Planejamento Semanal", projecao["ano"])
    capacidade = pl.parse_global(p, projecao["ano"])

    # A grade, a lista de demanda e a alocacao sao do mes que a aba "Projeção das linhas"
    # esta planejando; anexa ao cenario mensal daquele mes (cria se a aba nao o cobrir).
    alvo = next(
        (c for c in mensais if c["mes"] == projecao["mes"] and c["ano"] == projecao["ano"]),
        None,
    )
    if alvo is None:
        alvo = {
            "nome": f"{pl.MESES[projecao['mes'] - 1]}/{projecao['ano']}",
            "tipo": "mensal",
            "mes": projecao["mes"],
            "ano": projecao["ano"],
            "dispositivos": [],
            "metas": {},
            "periodos": [],
            "demandas": [],
            "termos": [],
            "observacao": "Criado para receber o calendário da Projeção das linhas",
        }
        mensais.append(alvo)
    alvo["projecao"] = projecao
    alvo["demandaProcesso"] = pl.parse_demandas(p)
    alvo["alocacao"] = pl.parse_alocacao(p)

    # Produtos citados so no mapa SKU->produto (ex.: "OEE Trac", que nao existe na base).
    todos_produtos = sorted(set(produtos) | {m["produto"] for m in sku_produto})

    dispositivos = []
    vistos = set()
    for cen in [*mensais, *semanais, capacidade]:
        for nome in cen["dispositivos"]:
            if nome not in vistos:
                vistos.add(nome)
                dispositivos.append({"nome": nome, "ordem": len(dispositivos)})

    return {
        "planilha": pl.PLANILHA_ID,
        "avisosOrigem": sku_duplicados,
        "sku": sku,
        "produtos": todos_produtos,
        "aliases": aliases,
        "processos": processos,
        "skuProduto": sku_produto,
        "dispositivos": dispositivos,
        "cenarios": [capacidade, *semanais, *mensais],
    }


def resumo(payload):
    linhas = [
        f"sku                : {len(payload['sku'])} códigos distintos"
        f" ({len(payload['avisosOrigem'])} duplicados na aba, mesclados)",
        f"produtos           : {len(payload['produtos'])}",
        f"aliases            : {len(payload['aliases'])}  {list(payload['aliases']) or ''}",
        f"processos          : {len(payload['processos'])}",
        f"mapa SKU->produto  : {len(payload['skuProduto'])}"
        f" ({sum(1 for m in payload['skuProduto'] if m['soNoCodigoMorto'])} só no código morto)",
        f"dispositivos       : {len(payload['dispositivos'])}",
    ]
    for cen in payload["cenarios"]:
        linhas.append(
            f"cenário {cen['tipo']:<11}: {len(cen['periodos'])} períodos, "
            f"{len(cen['termos'])} termos, {len(cen['demandas'])} demandas"
            + (f", {len(cen.get('metricaComponentes', []))} componentes" if cen.get("metricaComponentes") else "")
            + (f", {len(cen['projecao']['slots'])} slots" if cen.get("projecao") else "")
            + (f", {len(cen['demandaProcesso'])} linhas de demanda" if cen.get("demandaProcesso") else "")
            + (f", {len(cen['alocacao'])} alocações" if cen.get("alocacao") else "")
        )
    return "\n".join("  " + l for l in linhas)


def enviar(api, payload):
    url = f"{api.rstrip('/')}/api/importacao"
    corpo = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=corpo,
        method="POST",
        headers={
            "Content-Type": "application/json",
            # Dev local: o gateway da Vibe injeta este header em producao.
            "X-Auth-Email": "vsuriani@tractian.com",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"POST {url} falhou: {e.code} {e.read().decode('utf-8', 'replace')[:400]}")
    except urllib.error.URLError as e:
        raise SystemExit(f"não consegui falar com {url}: {e.reason}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", action="store_true", help="ler do .cache em vez da API")
    ap.add_argument("--dry-run", action="store_true", help="não envia, só salva o payload")
    ap.add_argument(
        "--api",
        default="http://localhost:3101",
        help="base do app (padrão = porta do dev server deste projeto)",
    )
    args = ap.parse_args()

    p = pl.do_dump() if args.dump else pl.da_api()
    payload = montar_payload(p)

    print("payload montado:")
    print(resumo(payload))

    if args.dry_run:
        SAIDA_DRY.parent.mkdir(parents=True, exist_ok=True)
        SAIDA_DRY.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\n--dry-run: nada enviado. Payload em {SAIDA_DRY}")
        return

    resultado = enviar(args.api, payload)
    print("\ngravado no banco:")
    for chave, valor in sorted(resultado["contagens"].items()):
        print(f"  {chave:<22} {valor}")
    if resultado["avisos"]:
        print(f"\n{len(resultado['avisos'])} aviso(s):")
        for a in resultado["avisos"][:20]:
            print(f"  {a}")


if __name__ == "__main__":
    main()
