import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSystems, createSystem } from '../api/systems'
import type { System } from '../api/systems'

export default function SystemsPage() {
  const navigate = useNavigate()

  const [systems, setSystems] = useState<System[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  // Modal form state
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formGitlabUser, setFormGitlabUser] = useState('')
  const [formGitlabToken, setFormGitlabToken] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const fetchSystems = async () => {
    try {
      const data = await listSystems()
      setSystems(data)
    } catch {
      // silently fail, list will be empty
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSystems()
  }, [])

  const resetForm = () => {
    setFormName('')
    setFormDesc('')
    setFormGitlabUser('')
    setFormGitlabToken('')
    setCreateError('')
  }

  const openModal = () => {
    resetForm()
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setCreateError('')
    setCreating(true)

    try {
      await createSystem({
        name: formName,
        description: formDesc || undefined,
        gitlab_username: formGitlabUser || undefined,
        gitlab_token: formGitlabToken || undefined,
      })
      closeModal()
      await fetchSystems()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const resp = (err as { response?: { data?: { message?: string } } }).response
        setCreateError(resp?.data?.message || '创建失败')
      } else {
        setCreateError('网络错误，请稍后重试')
      }
    } finally {
      setCreating(false)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">系统管理</h1>
          <button
            onClick={openModal}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-md px-4 py-2 text-sm transition-colors cursor-pointer"
          >
            + 新建系统
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-20 text-gray-400">加载中...</div>
        )}

        {/* Empty state */}
        {!loading && systems.length === 0 && (
          <div className="text-center py-20">
            <p className="text-gray-400 mb-4">暂无系统</p>
            <button
              onClick={openModal}
              className="text-indigo-600 hover:text-indigo-700 text-sm font-medium cursor-pointer"
            >
              创建你的第一个系统
            </button>
          </div>
        )}

        {/* System grid */}
        {!loading && systems.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {systems.map((sys) => (
              <div
                key={sys.id}
                onClick={() => navigate(`/systems/${sys.id}`)}
                className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-6 cursor-pointer border border-gray-100"
              >
                <h2 className="text-lg font-semibold text-gray-900 mb-2">{sys.name}</h2>
                <p className="text-gray-500 text-sm mb-4 line-clamp-2">
                  {sys.description || '暂无描述'}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    创建于: {formatDate(sys.created_at)}
                  </span>
                  <span className="text-indigo-600 hover:text-indigo-700 text-sm font-medium">
                    查看详情
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create System Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex justify-center items-start"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div className="bg-white rounded-xl max-w-lg w-full mx-4 mt-20 p-6">
            {/* Modal header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">新建系统</h2>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal form */}
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label htmlFor="sys-name" className="block text-sm font-medium text-gray-700 mb-1">
                  系统名称 <span className="text-red-500">*</span>
                </label>
                <input
                  id="sys-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="请输入系统名称"
                />
              </div>

              <div>
                <label htmlFor="sys-desc" className="block text-sm font-medium text-gray-700 mb-1">
                  系统描述
                </label>
                <textarea
                  id="sys-desc"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                  placeholder="请输入系统描述"
                />
              </div>

              <div>
                <label htmlFor="sys-gitlab-user" className="block text-sm font-medium text-gray-700 mb-1">
                  GitLab 用户名
                </label>
                <input
                  id="sys-gitlab-user"
                  type="text"
                  value={formGitlabUser}
                  onChange={(e) => setFormGitlabUser(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="GitLab 用户名"
                />
              </div>

              <div>
                <label htmlFor="sys-gitlab-token" className="block text-sm font-medium text-gray-700 mb-1">
                  GitLab 密码/Token
                </label>
                <input
                  id="sys-gitlab-token"
                  type="password"
                  value={formGitlabToken}
                  onChange={(e) => setFormGitlabToken(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="密码或 Access Token"
                />
              </div>

              {createError && (
                <p className="text-red-500 text-sm">{createError}</p>
              )}

              {/* Modal actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {creating ? '创建中...' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
