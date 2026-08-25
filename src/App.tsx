import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Inicio } from './paginas/Inicio'
import { Planejamento } from './paginas/Planejamento'
import { DimensionamentoGlobal } from './paginas/DimensionamentoGlobal'
import { Calendario } from './paginas/Calendario'
import { Demandas } from './paginas/Demandas'
import { Simulacao } from './paginas/Simulacao'
import { Operadores } from './paginas/Operadores'
import { Roteiros } from './paginas/Roteiros'
import { Sku } from './paginas/Sku'
import { Cenarios } from './paginas/Cenarios'
import { Importar } from './paginas/Importar'

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/inicio" replace />} />

        <Route path="/inicio" element={<Inicio />} />

        <Route path="/semanal" element={<Planejamento />} />
        <Route path="/dimensionamento-global" element={<DimensionamentoGlobal />} />

        <Route path="/calendario" element={<Calendario />} />
        <Route path="/demandas" element={<Demandas />} />
        <Route path="/simulacao" element={<Simulacao />} />
        <Route path="/operadores" element={<Operadores />} />

        <Route path="/roteiros" element={<Roteiros />} />
        <Route path="/sku" element={<Sku />} />

        <Route path="/cenarios" element={<Cenarios />} />
        <Route path="/importar" element={<Importar />} />

        <Route path="*" element={<Navigate to="/inicio" replace />} />
      </Route>
    </Routes>
  )
}
