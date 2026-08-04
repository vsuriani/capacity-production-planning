/** Cliente HTTP das rotas /api. Mesma origem no Vibe, proxy do Vite no dev. */

async function requisicao<T>(metodo: string, rota: string, corpo?: unknown): Promise<T> {
  const resposta = await fetch(`/api/${rota}`, {
    method: metodo,
    headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })

  if (!resposta.ok) {
    const texto = await resposta.text()
    let mensagem = texto
    try {
      mensagem = (JSON.parse(texto) as { erro?: string }).erro ?? texto
    } catch {
      /* resposta não-JSON: usa o texto cru */
    }
    throw new Error(mensagem || `HTTP ${resposta.status}`)
  }

  if (resposta.status === 204) return undefined as T
  return resposta.json() as Promise<T>
}

export const apiGet = <T>(rota: string) => requisicao<T>('GET', rota)
export const apiPost = <T>(rota: string, corpo?: unknown) => requisicao<T>('POST', rota, corpo)
export const apiPatch = <T>(rota: string, corpo?: unknown) => requisicao<T>('PATCH', rota, corpo)
export const apiDelete = <T>(rota: string) => requisicao<T>('DELETE', rota)
