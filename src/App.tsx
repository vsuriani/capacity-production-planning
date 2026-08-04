import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Capacidade } from './paginas/Capacidade'
import { Planejamento } from './paginas/Planejamento'
import { Calendario } from './paginas/Calendario'
import { Demandas } from './paginas/Demandas'
import { Operadores } from './paginas/Operadores'
import { Roteiros } from './paginas/Roteiros'
import { Sku } from './paginas/Sku'
import { Cenarios } from './paginas/Cenarios'
import { Importar } from './paginas/Importar'

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/capacidade" replace />} />

        <Route path="/capacidade" element={<Capacidade />} />
        <Route
          path="/semanal"
          element={
            <Planejamento
              tipo="semanal"
              titulo="Cenário semanal"
              abaOrigem="Planejamento Semanal"
            />
          }
        />
        <Route
          path="/mensal"
          element={
            <Planejamento tipo="mensal" titulo="Cenário mensal" abaOrigem="Planejamento Mensal" />
          }
        />

        <Route path="/calendario" element={<Calendario />} />
        <Route path="/demandas" element={<Demandas />} />
        <Route path="/operadores" element={<Operadores />} />

        <Route path="/roteiros" element={<Roteiros />} />
        <Route path="/sku" element={<Sku />} />

        <Route path="/cenarios" element={<Cenarios />} />
        <Route path="/importar" element={<Importar />} />

        <Route path="*" element={<Navigate to="/capacidade" replace />} />
      </Route>
    </Routes>
  )
}
