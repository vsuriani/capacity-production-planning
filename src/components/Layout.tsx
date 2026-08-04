import { NavLink, Outlet } from 'react-router-dom'
import {
  BarChart3, CalendarRange, ClipboardList, Database, Download, GitCompare,
  Grid3x3, LayoutGrid, ListTree, Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiGet } from '../lib/api'

type Secao = { titulo: string; itens: { para: string; rotulo: string; Icone: typeof BarChart3 }[] }

const SECOES: Secao[] = [
  {
    titulo: 'Planejamento',
    itens: [
      { para: '/capacidade', rotulo: 'Capacidade', Icone: BarChart3 },
      { para: '/semanal', rotulo: 'Semanal', Icone: LayoutGrid },
      { para: '/mensal', rotulo: 'Mensal', Icone: Grid3x3 },
    ],
  },
  {
    titulo: 'Execução',
    itens: [
      { para: '/calendario', rotulo: 'Calendário', Icone: CalendarRange },
      { para: '/demandas', rotulo: 'Lista de demanda', Icone: ClipboardList },
      { para: '/operadores', rotulo: 'Operadores', Icone: Users },
    ],
  },
  {
    titulo: 'Cadastros',
    itens: [
      { para: '/roteiros', rotulo: 'Processos e sequências', Icone: ListTree },
      { para: '/sku', rotulo: 'Base de PROD', Icone: Database },
    ],
  },
  {
    titulo: 'Plataforma',
    itens: [
      { para: '/cenarios', rotulo: 'Cenários', Icone: GitCompare },
      { para: '/importar', rotulo: 'Importação', Icone: Download },
    ],
  },
]

export function Layout() {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    apiGet<{ email: string }>('me')
      .then((r) => setEmail(r.email))
      .catch(() => setEmail(null))
  }, [])

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="px-5 py-5 border-b border-slate-200">
          <div className="font-heading font-bold text-[0.9375rem] tracking-tight text-slate-900">
            Dimensionamento
          </div>
          <div className="label-overline mt-0.5">de Linha</div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4">
          {SECOES.map((secao) => (
            <div key={secao.titulo} className="mb-5">
              <div className="label-overline px-5 mb-1.5">{secao.titulo}</div>
              {secao.itens.map(({ para, rotulo, Icone }) => (
                <NavLink
                  key={para}
                  to={para}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-2.5 px-5 py-2 text-sm transition-colors border-l-2',
                      isActive
                        ? 'border-primary-600 bg-primary-50 text-primary-700 font-medium'
                        : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                    ].join(' ')
                  }
                >
                  <Icone size={16} strokeWidth={1.75} />
                  {rotulo}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-slate-200">
          <div className="label-overline">Sessão</div>
          <div className="text-xs text-slate-600 mt-0.5 truncate" title={email ?? ''}>
            {email ?? 'não autenticado'}
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 px-8 py-7">
        <Outlet />
      </main>
    </div>
  )
}
