import { useAuth } from '../hooks/useAuth'
import { useNavigate, Link, Outlet } from 'react-router-dom'

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 h-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-indigo-600 hover:text-indigo-700 transition-colors">AI Context</Link>

          <div className="flex items-center gap-4">
            {user?.role === 'admin' && (
              <Link
                to="/admin"
                className="text-sm text-gray-500 hover:text-indigo-600"
              >
                管理面板
              </Link>
            )}
            <Link
              to="/settings"
              className="text-sm text-gray-500 hover:text-indigo-600"
            >
              设置
            </Link>
            {user && (
              <span className="text-sm text-gray-600">{user.username}</span>
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
            >
              退出
            </button>
          </div>
        </div>
      </nav>

      <main
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"
        style={{ minHeight: 'calc(100vh - 64px)' }}
      >
        <Outlet />
      </main>
    </div>
  )
}
